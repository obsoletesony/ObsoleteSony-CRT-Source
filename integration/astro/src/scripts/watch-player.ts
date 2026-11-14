import {getWatchCrop43,WATCH_VIDEO_ASPECT_RATIO} from '../lib/watchCrop43';
import {loadCRT,type CRTSession,type CRTRuntime,type CRTProgress} from '../lib/crt';

type State='off'|'idle'|'drag-over'|'loading'|'playing'|'paused'|'ended'|'exporting'|'complete'|'error';
const page=document.querySelector<HTMLElement>('[data-watch-app]');
if(page) {
  const element=<T extends HTMLElement>(selector:string)=>page.querySelector<T>(selector)!;
  const stage=element('#watch-stage'), screen=element<HTMLButtonElement>('#watch-screen-action');
  const canvas=element<HTMLCanvasElement>('#watch-video'), input=element<HTMLInputElement>('#watch-file');
  const osd=element('[data-watch-osd]'), sub=element('[data-watch-subosd]'), status=element('#watch-status');
  const progress=element('[data-watch-progress]'), segments=element('[data-watch-segments]');
  const save=element<HTMLButtonElement>('[data-watch-save]'), cancel=element<HTMLButtonElement>('[data-watch-cancel]');
  let session:CRTSession|null=null, runtime:CRTRuntime|null=null;
  let generation=0, loadController:AbortController|null=null;
  let state:State='off', beforeDrag:State='idle', depth=0;
  let saving=false, cancelRequested=false;
  let download:{url:string;remove:()=>Promise<void>;timer:number}|null=null;
  const uiAbort=new AbortController();
  const statusText=(text:string)=>{status.textContent=text;};
  function setState(next:State) {
    state=next;page!.dataset.state=next;
    const labels:Record<State,[string,string]>={off:['',''],idle:['DROP VIDEO','OR CLICK TO SELECT'],'drag-over':['RELEASE TO PLAY',''],loading:['LOADING...',''],playing:['',''],paused:['PAUSE',''],ended:['REPLAY','CLICK TO PLAY AGAIN'],exporting:['RECORDING',''],complete:['COMPLETE','CLICK TO PLAY AGAIN'],error:['NO SIGNAL','TRY ANOTHER FILE']};
    [osd.textContent,sub.textContent]=labels[next];sub.hidden=!labels[next][1];
    save.hidden=!session || !['paused','ended','complete'].includes(next);
    cancel.hidden=next!=='exporting';cancel.disabled=false;
    progress.hidden=next!=='exporting';
    screen.disabled=next==='loading'||next==='exporting';
    screen.setAttribute('aria-label',next==='playing'?'Pause processed video':session&&next!=='error'?'Play processed video':'Choose a local video file');
  }
  async function clearDownload() {
    const previous=download;download=null;if(!previous) return;
    clearTimeout(previous.timer);URL.revokeObjectURL(previous.url);await previous.remove().catch(()=>{});
  }
  async function loadFile(file?:File) {
    if(!file) return;
    const token=++generation;loadController?.abort();loadController=new AbortController();
    const previous=session;session=null;
    setState('loading');statusText(`Opening ${file.name} on your computer.`);
    window.dispatchEvent(new CustomEvent('watch:source-selected',{detail:{file}}));
    try {
      await previous?.destroy();await clearDownload();
      if(token!==generation) return;
      if(!file.type.startsWith('video/')&&!/\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(file.name)) throw new Error('Choose a video file such as MP4, MOV or WebM.');
      runtime=await loadCRT();if(token!==generation) return;
      const loaded=await runtime.CRTSession.open(file,canvas,{signal:loadController.signal});
      if(token!==generation) {await loaded.destroy();return;}
      session=loaded;
      const meta=loaded.metadata, crop=getWatchCrop43(meta.width,meta.height);
      if(JSON.stringify(crop)!==JSON.stringify(meta.crop)) throw new Error('Video crop does not match the TV framing.');
      window.dispatchEvent(new CustomEvent('watch:video-ready',{detail:{file,sourceWidth:meta.width,sourceHeight:meta.height,aspectRatio:WATCH_VIDEO_ASPECT_RATIO,crop}}));
      const refresh=()=>{
        if(session!==loaded||saving||state==='drag-over') return;
        setState(loaded.state==='playing'?'playing':loaded.timestamp>=meta.duration-.04?'ended':'paused');
      };
      loaded.addEventListener('statechange',refresh);loaded.addEventListener('frame',refresh);
      loaded.addEventListener('error',(event)=>{
        if(session!==loaded||saving) return;
        setState('error');statusText(`Playback stopped: ${(event as ErrorEvent).message}. Choose another file.`);
      });
      setState('paused');
      statusText(`Processed video ready${meta.hasAudio?' with sound':''}. Click the television to pause or resume.`);
      try {await loaded.play();if(token===generation) refresh();}
      catch {if(token===generation) {setState('paused');statusText('Video loaded. Click the television to start sound and playback.');}}
    } catch(error) {
      if(token!==generation) return;
      const failed=session;session=null;await failed?.destroy();
      setState('error');statusText(`Unable to open this video. ${error instanceof Error?error.message:String(error)}`);
    }
  }
  async function toggle() {
    if(!session || state==='error') {input.click();return;}
    if(saving||state==='loading') return;
    const current=session;
    try {
      if(current.state==='playing') {current.pause();setState('paused');}
      else {if(current.timestamp>=current.metadata.duration-.04) await current.seek(0);await current.play();if(session===current)setState('playing');}
    } catch(error) {if(session===current){setState('paused');statusText(`Could not start playback: ${String(error)}`);}}
  }
  function showProgress(value:CRTProgress) {
    const lit=Math.round(value.fraction*24);
    Array.from(segments.children).forEach((segment,index)=>segment.classList.toggle('is-lit',index<lit));
    sub.textContent=value.phase==='finalizing'?'FINALIZING':`${Math.floor(value.fraction*100)}%`;sub.hidden=false;
    statusText(value.phase==='finalizing'?'Finalizing processed video.':`Recording: ${Math.floor(value.fraction*100)}%.`);
    window.dispatchEvent(new CustomEvent('watch:export-progress',{detail:{progress:value.fraction,...value}}));
  }
  async function saveVideo() {
    if(!session||!runtime||saving) return;
    const current=session, token=generation;
    const filename='obsolete-'+(input.dataset.filename||'video')+'.mp4';
    // Invoke before the first await: native file pickers require this click's user activation.
    const destination=runtime.requestDestination(filename);
    saving=true;cancelRequested=false;current.pause();setState('exporting');showProgress({fraction:0,processedSeconds:0,duration:current.metadata.duration,phase:'rendering'});
    let temporary:Awaited<ReturnType<CRTRuntime['temporaryDestination']>>|null=null;
    try {
      let handle=await destination;
      if(cancelRequested||token!==generation) throw new DOMException('Recording cancelled','AbortError');
      if(!handle) {temporary=await runtime.temporaryDestination();handle=temporary.handle;}
      if(cancelRequested||token!==generation) throw new DOMException('Recording cancelled','AbortError');
      const file=await current.export(handle,value=>{if(token===generation)showProgress(value);},!!temporary);
      if(token!==generation) return;
      if(file&&temporary) {
        await clearDownload();
        const url=URL.createObjectURL(file), remove=temporary.remove;
        const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();
        download={url,remove,timer:window.setTimeout(()=>void clearDownload(),60_000)};temporary=null;
      }
      setState('complete');statusText('Your processed video with sound has been saved. Click the television to replay.');
      window.dispatchEvent(new CustomEvent('watch:export-complete'));
    } catch(error) {
      if(token!==generation) return;
      setState('paused');
      if(error instanceof DOMException&&error.name==='AbortError') statusText('Recording cancelled. SAVE VIDEO to try again.');
      else {osd.textContent='SAVE FAILED';statusText(`Could not save the recording. ${error instanceof Error?error.message:String(error)}. SAVE VIDEO to retry.`);}
    } finally {
      await temporary?.remove().catch(()=>{});
      saving=false;if(token===generation) cancel.disabled=false;
    }
  }
  for(let i=0;i<24;i++) segments.append(document.createElement('span'));
  screen.addEventListener('click',()=>void toggle());
  save.addEventListener('click',()=>void saveVideo());
  cancel.addEventListener('click',()=>{cancelRequested=true;cancel.disabled=true;sub.textContent='CANCELLING';sub.hidden=false;void session?.cancelExport();});
  input.addEventListener('change',()=>{const file=input.files?.[0];if(file)input.dataset.filename=file.name.replace(/\.[^.]+$/,'').replace(/[^\w-]+/g,'-').slice(0,80);void loadFile(file);input.value='';});
  const containsFiles=(event:DragEvent)=>Array.from(event.dataTransfer?.types??[]).includes('Files');
  stage.addEventListener('dragenter',event=>{if(!containsFiles(event))return;event.preventDefault();if(saving)return;if(++depth===1){beforeDrag=state;setState('drag-over');}});
  stage.addEventListener('dragover',event=>{if(!containsFiles(event))return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=saving?'none':'copy';});
  stage.addEventListener('dragleave',event=>{if(!containsFiles(event))return;event.preventDefault();depth=Math.max(0,depth-1);if(!depth&&state==='drag-over')setState(beforeDrag);});
  stage.addEventListener('drop',event=>{if(!containsFiles(event))return;event.preventDefault();depth=0;if(saving)return;const file=event.dataTransfer?.files?.[0];if(file){input.dataset.filename=file.name.replace(/\.[^.]+$/,'').replace(/[^\w-]+/g,'-').slice(0,80);void loadFile(file);}else setState(beforeDrag);});
  window.addEventListener('dragover',event=>{if(containsFiles(event))event.preventDefault();},{signal:uiAbort.signal});
  window.addEventListener('drop',event=>{if(containsFiles(event))event.preventDefault();},{signal:uiAbort.signal});
  // Internal integration seam for keyboard/accessibility clients and automated seek verification; no timeline UI.
  window.addEventListener('watch:seek',event=>{const seconds=Number((event as CustomEvent).detail?.seconds);if(session&&!saving&&Number.isFinite(seconds))void session.seek(seconds).catch(error=>statusText(String(error)));},{signal:uiAbort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.state==='playing')session.pause();},{signal:uiAbort.signal});
  const cleanup=()=>{generation++;loadController?.abort();uiAbort.abort();void session?.destroy();void clearDownload();};
  window.addEventListener('pagehide',cleanup,{once:true});
  document.addEventListener('astro:before-swap',cleanup,{once:true});
  window.setTimeout(()=>{if(state==='off'){setState('idle');statusText('Drop a video file onto the television, or choose one from your computer.');}},matchMedia('(prefers-reduced-motion: reduce)').matches?0:450);
}
