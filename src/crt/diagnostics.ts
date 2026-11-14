/** Local-only diagnostics. Never contains media bytes, filenames or network uploads. */
export type OpenStage = 'container'|'video-capability'|'first-frame'|'audio-selection'|'indexing'|'wasm'|'ready';
export type Diagnostic = {stage:OpenStage;state:'start'|'done'|'progress'|'error';elapsedMs:number;frames?:number;fraction?:number;details?:unknown};
export type OpenOptions = {signal?:AbortSignal;onDiagnostic?:(event:Diagnostic)=>void};
export class MediaOpenError extends Error {
    constructor(readonly stage:OpenStage, message:string, readonly osd='VIDEO ERROR', readonly hint='RETRY OR CONVERT TO MP4', options?:ErrorOptions) {
        super(message,options);this.name='MediaOpenError';
    }
}
export async function inspectStage<T>(options:OpenOptions,stage:OpenStage,task:()=>Promise<T>):Promise<T> {
    options.signal?.throwIfAborted();const start=performance.now();
    options.onDiagnostic?.({stage,state:'start',elapsedMs:0});
    try {
        const result=await task();options.signal?.throwIfAborted();
        options.onDiagnostic?.({stage,state:'done',elapsedMs:performance.now()-start});return result;
    } catch(error) {
        options.signal?.throwIfAborted();
        options.onDiagnostic?.({stage,state:'error',elapsedMs:performance.now()-start,details:String(error)});
        if(error instanceof MediaOpenError) throw error;
        throw new MediaOpenError(stage,`${stage}: ${error instanceof Error?error.message:String(error)}`,undefined,undefined,{cause:error});
    }
}
