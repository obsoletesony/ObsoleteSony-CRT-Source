/** Public contract of the versioned, separately built local CRT runtime. */
export interface CRTProgress {fraction:number;processedSeconds:number;duration:number;phase:'rendering'|'finalizing'|'complete'}
export interface CRTSession extends EventTarget {
  metadata:{width:number;height:number;duration:number;crop:{x:number;y:number;width:number;height:number};hasAudio:boolean;frameCount:number;firstTimestamp:number;audioTrackId:number|null;warnings:string[]};
  state:'playing'|'paused'; timestamp:number; seed:number;
  /** Exposed by the pinned headless CRT runtime. Playback volume does not affect export. */
  player:{volume:number};
  play():Promise<void>;pause():void;seek(seconds:number):Promise<void>;destroy():Promise<void>;
  export(handle:unknown,progress:(value:CRTProgress)=>void,temporary?:boolean):Promise<File|null>;
  cancelExport():Promise<void>;
}
export interface CRTRuntime {
  CRTSession:{open(file:File,canvas:HTMLCanvasElement,options?:{signal:AbortSignal;onDiagnostic?:(event:{stage:string;state:string;elapsedMs:number;fraction?:number;details?:unknown})=>void}):Promise<CRTSession>};
  requestDestination(name:string):Promise<unknown|null>;
  temporaryDestination():Promise<{handle:unknown;remove():Promise<void>}>;
}
let runtime:Promise<CRTRuntime>|undefined;
export function loadCRT() {
  const global=window as typeof window & {__ObsoleteSonyCRT?:CRTRuntime};
  if(global.__ObsoleteSonyCRT) return Promise.resolve(global.__ObsoleteSonyCRT);
  return runtime ??= new Promise<CRTRuntime>((resolve,reject)=>{
    const script=document.createElement('script');script.type='module';script.src='/vendor/crt/1.0.1/browser-entry.js';
    const ready=()=>{if(global.__ObsoleteSonyCRT){cleanup();resolve(global.__ObsoleteSonyCRT);}};
    const cleanup=()=>window.removeEventListener('crt-runtime-ready',ready);
    script.onerror=()=>{cleanup();script.remove();runtime=undefined;reject(new Error('Unable to load the local video processor. Reload and try again.'));};
    window.addEventListener('crt-runtime-ready',ready,{once:true});document.head.append(script);
  });
}
