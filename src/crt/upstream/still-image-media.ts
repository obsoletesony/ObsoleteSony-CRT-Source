// Adapted from ntsc-rs-web 5d15ee0 (GPL-3.0-or-later). See docs/UPSTREAM-CHANGES.md.
import {ALL_FORMATS, AnyIterable, BlobSource, Input, InputAudioTrack, VideoSample, VideoSampleSink} from 'mediabunny';
import {TypedEvent, TypedEventTarget} from 'valadaptive-lib/util/typed-events';
import {inspectStage,MediaOpenError,type OpenOptions} from '../diagnostics';
import {selectAudio,type AudioSelection} from '../audio-selection';

export interface VideoSampleSinkLike {
    getSample(timestamp: number): Promise<VideoSample | null>;
    samples(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<VideoSample, void, unknown>;
    samplesAtTimestamps(timestamps: AnyIterable<number>): AsyncGenerator<VideoSample | null, void, unknown>;
    close?(): void;
}

export class StillImageSink implements VideoSampleSinkLike {
    private frame: VideoFrame;
    private _frameRate: number;
    private _duration: number;

    constructor(image: CanvasImageSource, frameRate: number, duration: number) {
        this.frame = new VideoFrame(image, {timestamp: 0});
        this._frameRate = frameRate;
        this._duration = duration;
    }

    get frameRate() {
        return this._frameRate;
    }

    set frameRate(frameRate: number) {
        this._frameRate = frameRate;
    }

    getSample(timestamp: number): Promise<VideoSample | null> {
        if (timestamp < 0 || timestamp >= this._duration) return Promise.resolve(null);
        const frameNum = Math.floor(timestamp * this._frameRate);
        const frameStamp = frameNum / this._frameRate;
        const next = (frameNum + 1) / this._frameRate;
        return Promise.resolve(new VideoSample(this.frame.clone(), {
            timestamp: frameStamp,
            duration: next - frameStamp,
        }));
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async *samples(
        startTimestamp: number = 0,
        endTimestamp: number = Infinity,
    ): AsyncGenerator<VideoSample, void, unknown> {
        const frameRate = this._frameRate;
        const start = Math.floor(startTimestamp * frameRate);
        const end = Math.floor(Math.min(endTimestamp, this._duration) * frameRate);
        for (let i = start; i < end; i++) {
            const frameStamp = i / frameRate;
            const next = (i + 1) / frameRate;
            yield new VideoSample(this.frame.clone(), {
                timestamp: frameStamp,
                duration: next - frameStamp,
            });
            if (this._frameRate !== frameRate) {
                return;
            }
        }
    }

    async *samplesAtTimestamps(timestamps: AnyIterable<number>): AsyncGenerator<VideoSample | null, void, unknown> {
        for await (const timestamp of timestamps) {
            yield this.getSample(timestamp);
        }
    }

    close() {
        this.frame.close();
    }
}

export class FrameRateChangeEvent extends TypedEvent<'frameratechange'> {
    readonly frameRate: number;
    constructor(frameRate: number) {
        super('frameratechange');
        this.frameRate = frameRate;
    }
}

export class WrappedInput extends TypedEventTarget<FrameRateChangeEvent> {
    private input: Input | null;
    private _audioTracks: InputAudioTrack[];
    private _videoSampleSink: VideoSampleSinkLike;
    private _frameRate: number | null;

    readonly duration: number | null;
    readonly visibleWidth: number;
    readonly visibleHeight: number;
    readonly isStillImage: boolean;
    firstTimestamp=0;
    audioSelection:AudioSelection={track:null,warnings:[],tracks:[]};
    private removeAbortListener=()=>{};

    private constructor(
        input: Input | null,
        frameRate: number | null,
        duration: number | null,
        audioTracks: InputAudioTrack[],
        videoSampleSink: VideoSampleSinkLike,
        width: number,
        height: number,
        isStillImage: boolean,
    ) {
        super();

        this.input = input;
        this.duration = duration;
        this._audioTracks = audioTracks;
        this._videoSampleSink = videoSampleSink;
        this._frameRate = frameRate;
        this.visibleWidth = width;
        this.visibleHeight = height;
        this.isStillImage = isStillImage;
    }

    static async create(source: Blob, options: OpenOptions & {
        calculateFrameRate?: boolean,
        stillImageFrameRate: number,
        stillImageDuration?: number,
        audioTrackId?:number|null,
    }) {
        if (source.type.startsWith('image/')) {
            const image = await createImageBitmap(source);
            const sink = new StillImageSink(
                image,
                options.stillImageFrameRate,
                options.stillImageDuration ?? Infinity,
            );
            return new WrappedInput(
                null,
                options.stillImageFrameRate,
                options.stillImageDuration ?? null,
                [],
                sink,
                image.width,
                image.height,
                true,
            );
        }
        const input = new Input({
            source: new BlobSource(source),
            formats: ALL_FORMATS,
        });
        const abort=()=>input.dispose();
        options.signal?.addEventListener('abort',abort,{once:true});
        try {
        const {videoTrack,audioTracks}=await inspectStage(options,'container',async()=>({
            videoTrack:await input.getPrimaryVideoTrack(),audioTracks:await input.getAudioTracks(),
        }));
        if (!videoTrack) {
            throw new MediaOpenError('container','This file has no video track.','NO VIDEO TRACK','SELECT A VIDEO FILE');
        }
        await inspectStage(options,'video-capability',async()=>{
            const codec=await videoTrack.getCodecParameterString()??await videoTrack.getInternalCodecId()??'unknown';
            options.onDiagnostic?.({stage:'video-capability',state:'progress',elapsedMs:0,details:{codec}});
            if(!await videoTrack.canDecode()) throw new MediaOpenError('video-capability',`This browser cannot decode video codec ${String(codec)} for CRT processing. Convert the file locally to H.264 (8-bit yuv420p) with AAC audio in MP4, then select that file. No video was uploaded.`, 'VIDEO UNSUPPORTED','CONVERT TO H.264 MP4');
        });
        const videoSampleSink = new VideoSampleSink(videoTrack);
        const firstTimestamp=Math.max(0,await videoTrack.getFirstTimestamp());
        await inspectStage(options,'first-frame',async()=>{
            const sample=await videoSampleSink.getSample(firstTimestamp);
            if(!sample) throw new Error(`No decoded video frame at the first presentation timestamp (${firstTimestamp}s).`);
            sample.close();
        });
        const selection=await inspectStage(options,'audio-selection',()=>selectAudio(audioTracks,options,options.audioTrackId));
        options.onDiagnostic?.({stage:'audio-selection',state:'progress',elapsedMs:0,details:{tracks:selection.tracks,selectedId:selection.track?.id??null,warnings:selection.warnings}});
        // Matroska duration metadata may include the start offset already. Use actual end timestamps.
        const duration=await inspectStage(options,'container',()=>input.computeDuration([videoTrack,...(selection.track?[selection.track]:[])]));

        let frameRate = null;
        if (options.calculateFrameRate) {
            // TODO: perform this calculation ourselves to get an idea of whether the video has a variable framerate.
            // Mediabunny only gives us the average framerate :(
            const packetStats = await videoTrack.computePacketStats(100);
            frameRate = packetStats.averagePacketRate;
        }

        const result=new WrappedInput(
            input,
            frameRate,
            duration,
            selection.track?[selection.track]:[],
            videoSampleSink,
            await videoTrack.getDisplayWidth(),
            await videoTrack.getDisplayHeight(),
            false,
        );
        result.firstTimestamp=firstTimestamp;result.audioSelection=selection;
        result.removeAbortListener=()=>options.signal?.removeEventListener('abort',abort);
        return result;
        } catch (error) {options.signal?.removeEventListener('abort',abort);input.dispose(); throw error; }
    }

    get audioTracks() {
        return this._audioTracks;
    }

    get frameRate(): number | null {
        return this._frameRate;
    }

    set frameRate(frameRate: number) {
        if (!this.isStillImage || this._frameRate === frameRate) return;
        (this._videoSampleSink as StillImageSink).frameRate = this._frameRate = frameRate;
        this.dispatchEvent(new FrameRateChangeEvent(frameRate));
    }

    get videoSink() {
        return this._videoSampleSink;
    }

    close() {
        this.removeAbortListener();
        this.input?.dispose();
        this._videoSampleSink.close?.();
    }
    finishOpening() {this.removeAbortListener();}
}
