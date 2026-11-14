// Adapted from ntsc-rs-web 5d15ee0 (GPL-3.0-or-later). See docs/UPSTREAM-CHANGES.md.
import {
    AudioSampleSink,
    AudioSampleSource,
    EncodedAudioPacketSource,
    EncodedPacketSink,
    Mp4OutputFormat,
    Output,
    StreamTarget,
    VideoSample,
    VideoSampleSource,
    WebMOutputFormat,
    AudioSource,
    getEncodableAudioCodecs,
    getEncodableVideoCodecs,
    registerEncoder,
} from 'mediabunny';
import type {PipelineSettings} from './media-player';
import EffectWorkerPool, {getRotation} from './effect-worker-pool';
import {TypedEvent, TypedEventTarget} from 'valadaptive-lib/util/typed-events';
type AppVideoCodec = 'avc' | 'vp8' | 'vp9' | 'av1';
import {WrappedInput} from './still-image-media';
import AACEncoder from './aac-codec';

export type RenderJobSettings = {
    videoCodec: AppVideoCodec,
    videoBitrate: number,
    effectSettings: PipelineSettings,
    stillImageFrameRate: number,
    stillImageDuration: number,
};

export type RenderJobState =
    | {state: 'waiting'}
    | {state: 'rendering'}
    | {state: 'finalizing'}
    // The file is present for OPFS render jobs, since those require the output file to be saved by the user
    | {state: 'completed', time: number, file: File | null}
    | {state: 'cancelled', reason: unknown}
    | {state: 'error', error: unknown};

export class StateChangeEvent extends TypedEvent<'statechange'> {
    state: RenderJobState;

    constructor(state: RenderJobState) {
        super('statechange');
        this.state = state;
    }
}

registerEncoder(AACEncoder);

export const supportedCodecsForVideo = getEncodableVideoCodecs(['avc', 'vp8', 'vp9', 'av1'])
    .then(codecs => new Set(codecs));
export const supportedCodecsForAudio = getEncodableAudioCodecs(['mp3', 'aac', 'opus', 'vorbis'])
    .then(codecs => new Set(codecs));

export default class RenderJob extends TypedEventTarget<ProgressEvent | StateChangeEvent | ErrorEvent> {
    private _state: RenderJobState = {state: 'waiting'};
    private _completionPromise: Promise<void>;
    private _startTime: number = Date.now() / 1000;
    readonly sourceFileName: string;
    readonly videoCodec: AppVideoCodec;
    readonly destination: FileSystemFileHandle;
    readonly isOPFS: boolean;

    private etaInfo: {
        progress: number;
        time: number;
        avgProgress: number;
        avgTime: number;
        discards: number;
        window: number;
    } | null = null;

    private abortController: AbortController = new AbortController();
    private input: Promise<WrappedInput>;
    private output: Output | null = null;

    constructor(
        source: Blob,
        sourceFileName: string,
        destination: FileSystemFileHandle,
        workerPool: Promise<EffectWorkerPool>,
        settings: RenderJobSettings,
        isOPFS: boolean,
    ) {
        super();
        this.destination = destination;
        this.sourceFileName = sourceFileName;
        this.isOPFS = isOPFS;
        this.videoCodec = settings.videoCodec;
        const inputPromise = WrappedInput.create(source, {
            stillImageFrameRate: settings.stillImageFrameRate,
            stillImageDuration: settings.stillImageDuration,
        });
        this.input = inputPromise;

        const signal = this.abortController.signal;

        const completionPromise = async() => {
            const input = await inputPromise;
            const duration = input.duration;
            if (duration === null || duration === Infinity) {
                throw new Error('Input has no duration');
            }
            const effectPool = await workerPool;

            let outputFormat;
            switch (settings.videoCodec) {
                case 'avc':
                    outputFormat = new Mp4OutputFormat();
                    break;
                default:
                    outputFormat = new WebMOutputFormat();
                    break;
            }

            const writable = await destination.createWritable();
            const target = new StreamTarget(writable, {chunked: true});
            const output = new Output({
                format: outputFormat,
                target,
            });
            this.output = output;

            signal.throwIfAborted();

            const audioEncoders: (() => Promise<void>)[] = [];

            let sourceSettings = null;
            if (input.audioTracks.length > 0) {
                const supported = await supportedCodecsForAudio;
                switch (settings.videoCodec) {
                    case 'avc':
                        if (supported.has('aac')) {
                            sourceSettings = {codec: 'aac', bitrate: 128 * 1000} as const;
                            break;
                        }
                        if (supported.has('mp3')) {
                            sourceSettings = {codec: 'mp3', bitrate: 256 * 1000} as const;
                            break;
                        }
                        break;
                    case 'vp8':
                    case 'vp9':
                    case 'av1':
                        if (supported.has('opus')) {
                            sourceSettings = {codec: 'opus', bitrate: 128 * 1000} as const;
                            break;
                        }
                        if (supported.has('vorbis')) {
                            sourceSettings = {codec: 'vorbis', bitrate: 256 * 1000} as const;
                            break;
                        }
                        break;
                };
            }

            for (const audioTrack of input.audioTracks) {
                let audioSource: AudioSource;
                if (
                    (
                        outputFormat.fileExtension === '.mp4' &&
                        (audioTrack.codec === 'aac' || audioTrack.codec === 'mp3')
                    ) ||
                    (
                        outputFormat.fileExtension === '.webm' &&
                        (audioTrack.codec === 'opus' || audioTrack.codec === 'vorbis')
                    )
                ) {
                    // We can pass through some audio codecs
                    audioSource = new EncodedAudioPacketSource(audioTrack.codec);
                    audioEncoders.push(async() => {
                        const audioSink = new EncodedPacketSink(audioTrack);
                        const config = {
                            decoderConfig: (await audioTrack.getDecoderConfig()) ?? undefined,
                        };
                        for await (const audioPacket of audioSink.packets()) {
                            if (signal.aborted) break;
                            // Some videos can have audio that starts before timestamp 0. Mediabunny errors out when
                            // muxing these, so drop them.
                            if (audioPacket.timestamp < 0) continue;
                            await (audioSource as EncodedAudioPacketSource).add(audioPacket, config);
                            if (signal.aborted) break;
                        }
                    });
                } else {
                    if (!sourceSettings) {
                        this.abortController.abort();
                        throw new DOMException(
                            'This browser doesn\'t support any audio codecs for the requested output format.\n' +
                            'Try a different format.',

                            'NotSupportedError',
                        );
                    }
                    audioSource = new AudioSampleSource(sourceSettings);
                    audioEncoders.push(async() => {
                        const audioSink = new AudioSampleSink(audioTrack);
                        for await (const sample of audioSink.samples()) {
                            if (signal.aborted) {
                                sample.close();
                                break;
                            }
                            if (sample.timestamp < 0) {
                                sample.close();
                                continue;
                            }
                            try {
                                await (audioSource as AudioSampleSource).add(sample);
                            } finally {
                                sample.close();
                            }
                            if (signal.aborted) break;
                        }
                    });
                }
                output.addAudioTrack(audioSource, {
                    languageCode: audioTrack.languageCode,
                    name: audioTrack.name ?? undefined,
                    disposition: audioTrack.disposition,
                });
            }

            // These are the only ones I can verify work without padding
            const padToEven = !(settings.videoCodec === 'vp8' || settings.videoCodec === 'vp9');
            const videoSampleSource = new VideoSampleSource({
                codec: settings.videoCodec,
                bitrate: settings.videoBitrate,
            });
            const videoSink = input.videoSink;
            output.addVideoTrack(videoSampleSource);
            await output.start();
            signal.throwIfAborted();
            this.changeState({state: 'rendering'});
            this._startTime = Date.now() / 1000;
            const framePipeline = async() => {
                const pending: {promise: Promise<VideoFrame>; timestamp: number; duration: number}[] = [];
                const emit = async() => {
                    const node = pending.shift()!;
                    const effectFrame = await node.promise;
                    if(signal.aborted) { effectFrame.close(); signal.throwIfAborted(); }
                    const sample = new VideoSample(effectFrame, {timestamp:node.timestamp,duration:node.duration});
                    try { await videoSampleSource.add(sample); } finally { sample.close(); }
                    this.updateETA((node.timestamp+node.duration)/duration, Date.now()/1000, effectPool.allWorkers.length);
                    this.dispatchEvent(new ProgressEvent('progress', {lengthComputable:true,loaded:Math.min(duration,node.timestamp+node.duration),total:duration}));
                };
                try {
                    for await (const frame of videoSink.samples()) {
                        if(signal.aborted) {frame.close(); signal.throwIfAborted();}
                        const timestamp=frame.timestamp, duration=frame.duration, rotation=getRotation(frame.rotation);
                        const videoFrame=frame.toVideoFrame(), squarePixelWidth=frame.squarePixelWidth, squarePixelHeight=frame.squarePixelHeight; frame.close();
                        const promise=effectPool.processFrame({frame:videoFrame,squarePixelWidth,squarePixelHeight,rotation,frameNum:0,padToEven,...settings.effectSettings},'videoframe').then(getFrame=>getFrame());
                        void promise.catch(()=>{});
                        pending.push({promise,timestamp,duration});
                        if(pending.length>=effectPool.allWorkers.length) await emit();
                    }
                    while(pending.length) await emit();
                } finally {
                    await Promise.allSettled(pending.map(node=>node.promise.then(frame=>frame.close())));
                }
            };
            const tasks=[...audioEncoders.map(encode=>encode()),framePipeline()].map(task=>task.catch(error=>{this.abortController.abort(error);throw error;}));
            const results=await Promise.allSettled(tasks);
            const failure=results.find(result=>result.status==='rejected');
            if(failure?.status==='rejected') throw failure.reason;
            signal.throwIfAborted();

            this.changeState({state:'finalizing'});
            await output.finalize();
            signal.throwIfAborted();
            input.close();
            const file = isOPFS ? await destination.getFile() : null;
            this.changeState({state: 'completed', time: Date.now() / 1000, file});
        };

        this._completionPromise = (async() => {
            try {
                await completionPromise();
            } catch (error) {
                const cancelled = signal.aborted && signal.reason?.name === 'AbortError';
                this.abortController.abort(error);
                await this.output?.cancel().catch(()=>{});
                this.changeState(cancelled ? {state:'cancelled',reason:error} : {state:'error',error});
                throw error;
            } finally {
                await inputPromise.then(input=>input.close(),()=>{});
            }
        })();
    }

    get state() {
        return this._state;
    }

    private changeState(state: RenderJobState) {
        this._state = state;
        this.dispatchEvent(new StateChangeEvent(state));
    }

    private updateETA(progress: number, time: number, pipelineSize: number) {
        if (this.etaInfo === null) {
            this.etaInfo = {
                progress,
                time,
                avgProgress: progress,
                avgTime: time,
                discards: Math.round(pipelineSize * 1.5),
                window: 4,
            };
            return;
        }
        // Discard the first several samples since multithreading means frames get processed in batches, meaning the
        // first several probably all arrive at once
        if (this.etaInfo.discards > 0) {
            this.etaInfo.progress = this.etaInfo.avgProgress = progress;
            this.etaInfo.time = this.etaInfo.avgTime = time;
            this.etaInfo.discards--;
            return;
        }

        // Only update the ETA every half-second
        if (time - this.etaInfo.time < 0.5) return;
        // For the first few counted samples, we perform a simple windowed average instead of an exponential one
        if (this.etaInfo.window > 0) {
            this.etaInfo.progress = progress;
            this.etaInfo.time = time;
            this.etaInfo.window--;
            return;
        }

        const ALPHA = 0.1;
        // Calculating separate averages for the progress and time seems to give better results than calculating the
        // rate and averaging that
        this.etaInfo.avgProgress = (ALPHA * progress) + ((1 - ALPHA) * this.etaInfo.avgProgress);
        this.etaInfo.avgTime = (ALPHA * time) + ((1 - ALPHA) * this.etaInfo.avgTime);
        this.etaInfo.progress = progress;
        this.etaInfo.time = time;
    }

    get eta() {
        if (!this.etaInfo?.avgProgress || !this.etaInfo.avgTime || this.etaInfo.window > 0) return null;
        const avgRate = (this.etaInfo.progress - this.etaInfo.avgProgress) / (this.etaInfo.time - this.etaInfo.avgTime);
        return (1 - this.etaInfo.progress) / avgRate;
    }

    get completionPromise() {
        return this._completionPromise;
    }

    get startTime() {
        return this._startTime;
    }

    cancel(reason: unknown = new DOMException('Export cancelled','AbortError')) {
        this.abortController.abort(reason);
        return this._completionPromise.catch(()=>{});
    }
}
