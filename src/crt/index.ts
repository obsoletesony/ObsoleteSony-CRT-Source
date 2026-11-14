import MediaPlayer from './upstream/media-player';
import EffectWorkerPool from './upstream/effect-worker-pool';
import RenderJob, {supportedCodecsForVideo} from './upstream/render-job';
import {ResizeFilter,NtscSettingsList} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';
import {wasmModulePromise} from './upstream/ntsc-rs-module';
import {clipSeed,profiles,settingsAt,stateAt,validatePreset,UPSTREAM} from './profiles';
import {indexFrames,frameIndexAt} from './frame-index';
import {getWatchCrop43} from './crop';
import {WrappedInput} from './upstream/still-image-media';
import {inspectStage,type OpenOptions} from './diagnostics';

export {getWatchCrop43,profiles,stateAt,validatePreset,UPSTREAM};
export const VERSION='1.0.1';
export type ExportProgress={processedSeconds:number;duration:number;fraction:number;phase:'rendering'|'finalizing'|'complete'};
export class CRTSession extends EventTarget {
    readonly player: MediaPlayer;
    readonly file: File;
    readonly seed: number;
    readonly metadata: {width:number;height:number;duration:number;crop:ReturnType<typeof getWatchCrop43>;hasAudio:boolean;frameCount:number;firstTimestamp:number;audioTrackId:number|null;warnings:string[]};
    private pool: EffectWorkerPool;
    private settings;
    private job: RenderJob|null=null;
    private closed=false;
    private constructor(file:File,player:MediaPlayer,pool:EffectWorkerPool,seed:number,frameCount:number) {
        super(); this.file=file; this.player=player; this.pool=pool; this.seed=seed;
        this.settings={resizeHeight:480,resizeFilter:ResizeFilter.Bilinear,effectEnabled:true,effectSettings:profiles.stable,outputRect:null};
        this.metadata={width:player.width,height:player.height,duration:player.duration!,crop:getWatchCrop43(player.width,player.height),hasAudio:player.hasAudio,frameCount,firstTimestamp:player.input.firstTimestamp,audioTrackId:player.input.audioSelection.track?.id??null,warnings:player.input.audioSelection.warnings};
        player.addEventListener('statechange',()=>{this.dispatchEvent(new Event('statechange'));});
        player.addEventListener('frame',()=>{this.dispatchEvent(new Event('frame'));});
        player.addEventListener('error',(event:ErrorEvent)=>{this.dispatchEvent(new ErrorEvent('error',{error:event.error,message:event.message}));});
    }
    static async open(file:File,canvas:HTMLCanvasElement,options:OpenOptions&{wear?:boolean;concurrency?:number}={}) {
        if(!('VideoDecoder' in window) || !('VideoEncoder' in window) || !('AudioContext' in window)) throw new Error('This browser cannot process video locally. Please use current Chrome or Edge.');
        if(!file.size) throw new Error('The selected file is empty.');
        // Probe codecs and real samples BEFORE paying the whole-file canonical-index cost.
        const input=await WrappedInput.create(file,{...options,calculateFrameRate:true,stillImageFrameRate:30});
        let pool:EffectWorkerPool|null=null,player:MediaPlayer|null=null;
        try {
        const seed=await clipSeed(file);
        const timestamps=await inspectStage(options,'indexing',()=>indexFrames(file,options.signal,(frames,timestamp)=>options.onDiagnostic?.({stage:'indexing',state:'progress',elapsedMs:0,frames,fraction:Math.max(0,Math.min(.99,timestamp/(input.duration??Infinity)))})));
        await inspectStage(options,'wasm',async()=>{await wasmModulePromise;});
        const native=new NtscSettingsList();
        try { for(const profile of Object.values(profiles)) native.parsePreset(JSON.stringify(profile)); } finally {native.free();}
        pool=await EffectWorkerPool.create(options.concurrency);
        options.signal?.throwIfAborted();
            pool.resolveFrame=timestampUs=>{
                const frameNum=frameIndexAt(timestamps,timestampUs);
                return {frameNum,effectSettings:settingsAt(timestamps[frameNum]/1e6,frameNum,seed,options.wear!==false)};
            };
            player=await MediaPlayer.create(file,Promise.resolve(pool),{resizeHeight:480,resizeFilter:ResizeFilter.Bilinear,effectEnabled:true,effectSettings:profiles.stable,outputRect:null},30,input);
            if(!Number.isFinite(player.duration) || player.duration!<=0) throw new Error('The video has an invalid duration.');
            options.signal?.throwIfAborted();
            const session=new CRTSession(file,player,pool,seed,timestamps.length);
            player.canvas=canvas;
            await player.seek(0);
            options.signal?.throwIfAborted();
            input.finishOpening();
            options.onDiagnostic?.({stage:'ready',state:'done',elapsedMs:0,details:session.metadata});
            return session;
        } catch(error) {player?.destroy();input.close();pool?.destroy();options.signal?.throwIfAborted();throw error;}
    }
    get state() {return this.player.state;}
    get timestamp() {return this.player.timestamp;}
    get metrics() {return {...this.pool.metrics,workers:this.pool.allWorkers.length};}
    async play() {if(this.closed) return;await this.player.unlockAudio();if(!this.closed) this.player.state='playing';}
    pause() {this.player.state='paused';}
    async seek(seconds:number) {if(this.closed) return;await this.player.seek(Math.max(0,Math.min(seconds,this.metadata.duration-0.000001)));}
    async framePNG() {return this.player.currentFrameAsPNG();}
    async export(destination:FileSystemFileHandle,progress:(value:ExportProgress)=>void,isTemporary=false) {
        if(this.closed || this.job) throw new Error('The converter is unavailable or already recording.');
        if(!(await supportedCodecsForVideo).has('avc')) throw new Error('H.264 export is unavailable in this browser. Please try Chrome or Edge.');
        this.pause();
        const job=this.job=new RenderJob(this.file,this.file.name,destination,Promise.resolve(this.pool),{videoCodec:'avc',videoBitrate:4_000_000,effectSettings:this.settings,stillImageFrameRate:30,stillImageDuration:0,audioTrackId:this.metadata.audioTrackId},isTemporary);
        progress({fraction:0,processedSeconds:0,duration:this.metadata.duration,phase:'rendering'});
        let processedSeconds=0;
        job.addEventListener('progress',(event:ProgressEvent)=>{processedSeconds=event.loaded;progress({processedSeconds,duration:event.total,fraction:Math.min(.99,event.loaded/event.total),phase:'rendering'});});
        job.addEventListener('statechange',event=>{if(event.state.state==='finalizing')progress({processedSeconds,duration:this.metadata.duration,fraction:.99,phase:'finalizing'});});
        try {await job.completionPromise;progress({fraction:1,processedSeconds:this.metadata.duration,duration:this.metadata.duration,phase:'complete'});return job.state.state==='completed'?job.state.file:null;}
        finally {this.job=null;}
    }
    async cancelExport() {await this.job?.cancel();}
    async destroy() {
        if(this.closed) return;this.closed=true;this.player.destroy();
        try {await this.cancelExport();} finally {this.pool.destroy();}
    }
}

/** Call directly inside the SAVE VIDEO click so the native picker retains user activation. */
export function requestDestination(name:string):Promise<FileSystemFileHandle|null> {
    if(typeof window.showSaveFilePicker === 'function') return window.showSaveFilePicker({suggestedName:name,types:[{description:'Processed MP4 video',accept:{'video/mp4':['.mp4']}}]}).catch(error=>{if(error?.name==='AbortError') throw error;return null;});
    return Promise.resolve(null);
}
export async function temporaryDestination() {
    if(!navigator.storage?.getDirectory) throw new Error('Local temporary storage is unavailable. Enable browser storage or use Chrome/Edge.');
    const root=await navigator.storage.getDirectory();
    const directory=await root.getDirectoryHandle('obsoletesony-crt',{create:true});
    const name=`render-${crypto.randomUUID()}.mp4`;
    const handle=await directory.getFileHandle(name,{create:true});
    return {handle,remove:()=>directory.removeEntry(name)};
}
