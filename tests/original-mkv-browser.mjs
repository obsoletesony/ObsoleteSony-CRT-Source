// User-supplied media stays local. Evidence contains metrics/hashes, never frames or traces.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const file=process.env.CRT_ORIGINAL_FILE;if(!file)throw new Error('CRT_ORIGINAL_FILE is required');
const root=path.resolve(import.meta.dirname,'../..'),out=path.resolve(process.env.CRT_EVIDENCE??path.join(root,'original-mkv-evidence')),name=process.env.CRT_BROWSER??'chrome';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:name==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--js-flags=--expose-gc']});
const context=await browser.newContext({storageState:process.env.CRT_STORAGE_STATE,acceptDownloads:true,viewport:{width:1440,height:1000}}),page=await context.newPage(),report={browser:name,version:browser.version(),errors:[],uploads:[]};
page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))report.uploads.push({origin:new URL(r.url()).origin,bytes:r.postDataBuffer()?.length??0});});
await page.addInitScript(()=>{
 window.showSaveFilePicker=undefined;window.diagnostics=[];window.progress=null;window.openingHeap=[];
 setInterval(()=>{if(document.querySelector('[data-watch-app]')?.dataset.state==='loading'&&performance.memory)window.openingHeap.push(performance.memory.usedJSHeapSize);},25);
 window.addEventListener('watch:diagnostic',e=>window.diagnostics.push(e.detail));window.addEventListener('watch:export-progress',e=>window.progress=e.detail);
 window.addEventListener('crt-runtime-ready',()=>{const cls=window.__ObsoleteSonyCRT.CRTSession,open=cls.open;cls.open=async(...args)=>{const session=await open.apply(cls,args);window.session=session;return session;};});
});
try{
 report.site=process.env.CRT_SITE??'http://127.0.0.1:4321/watch';await page.goto(report.site);
 const manifest=await context.request.get(new URL('/vendor/crt/1.0.1/manifest.json',report.site).href);assert.equal(manifest.status(),200);
 report.manifestSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await manifest.body())),v=>v.toString(16).padStart(2,'0')).join('');
 const start=Date.now();await page.locator('#watch-file').setInputFiles(file);
 await page.waitForFunction(()=>!!window.session||document.querySelector('[data-watch-app]').dataset.state==='error',{},{timeout:120000});
 assert.notEqual(await page.locator('[data-watch-app]').getAttribute('data-state'),'error',await page.locator('#watch-status').innerText());
 report.openMs=Date.now()-start;report.metadata=await page.evaluate(()=>window.session.metadata);report.diagnostics=await page.evaluate(()=>window.diagnostics);assert(report.metadata.hasAudio);assert.equal(report.metadata.audioTrackId,2);
 report.openingHeap=await page.evaluate(()=>window.openingHeap.length?{min:Math.min(...window.openingHeap),max:Math.max(...window.openingHeap),samples:window.openingHeap.length}:null);
 report.preview=await page.evaluate(async()=>{
  const s=window.session,pool=s.pool;s.pause();window.hashes={};window.wanted=[];const original=pool.processFrame.bind(pool);
  pool.processFrame=async(settings,format)=>{const index=pool.resolveFrame(settings.frame.timestamp).frameNum,get=await original(settings,format);let checked=false;return async()=>{const frame=await get();if(!checked&&window.wanted.includes(index)&&(format==='imagebitmap'||format==='videoframe')){checked=true;const c=new OffscreenCanvas(640,480),ctx=c.getContext('2d');ctx.drawImage(frame,0,0);const digest=await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,640,480).data);(window.hashes[index]??={})[format]=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');}return frame;};};
  const samples=[];for(const requested of [1,60,300,Math.floor(s.metadata.duration/2),Math.floor(s.metadata.duration)-2]){const frame=await s.player.input.videoSink.getSample(requested);const index=pool.resolveFrame(Math.round(frame.timestamp*1e6)).frameNum;frame.close();window.wanted.push(index);await s.seek(requested);if(!window.hashes[index]?.imagebitmap)throw new Error('Missing processed preview hash');samples.push({requested,index,timestamp:s.timestamp,hash:window.hashes[index].imagebitmap});}
  for(const item of [...samples].reverse()){await s.seek(item.requested);if(window.hashes[item.index].imagebitmap!==item.hash)throw new Error('Seek changed processed frame');}
  await s.seek(60);const analyser=s.player.audioContext.createAnalyser();s.player.gainNode.connect(analyser);await s.play();let maxRms=0;const data=new Float32Array(analyser.fftSize);
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,20));analyser.getFloatTimeDomainData(data);maxRms=Math.max(maxRms,Math.sqrt(data.reduce((a,v)=>a+v*v,0)/data.length));}
  s.pause();s.player.gainNode.disconnect(analyser);return {samples,maxRms,metrics:s.metrics};
 });
 assert(report.preview.maxRms>.0001,'Original processed playback has no decoded audio energy');console.log(name+' original ready '+JSON.stringify({openMs:report.openMs,metadata:report.metadata,audioRms:report.preview.maxRms}));
 if(process.env.CRT_SMOKE_ONLY==='1'){
  await page.locator('[data-watch-save]').click();await page.waitForFunction(()=>window.progress?.processedSeconds>3,{},{timeout:120000});await page.locator('[data-watch-cancel]').click();await page.waitForFunction(()=>document.querySelector('[data-watch-app]').dataset.state==='paused',{},{timeout:60000});
  assert.match(await page.locator('#watch-status').innerText(),/cancelled/i);report.recordingCancelled=true;
  await page.evaluate(async()=>window.session.destroy());assert.deepEqual(report.errors,[]);console.log(name+' ORIGINAL LIVE PLAYBACK/CANCEL PASS');
 }else{
 const started=Date.now(),downloadPromise=page.waitForEvent('download',{timeout:1800000});let done=false;downloadPromise.then(()=>done=true,()=>done=true);await page.locator('[data-watch-save]').click();
 while(!done){await page.waitForTimeout(10000);const status=await page.evaluate(()=>({state:document.querySelector('[data-watch-app]').dataset.state,progress:window.progress,status:document.querySelector('#watch-status').textContent}));if(status.state==='paused'&&/could not save/i.test(status.status))throw new Error(status.status);console.log(name+' original export '+Math.floor((status.progress?.fraction??0)*100)+'%');}
 const download=await downloadPromise;await download.saveAs(path.join(out,`${name}-original-processed.mp4`));report.exportMs=Date.now()-started;report.outputBytes=(await fs.stat(path.join(out,`${name}-original-processed.mp4`))).size;
 report.completed=await page.evaluate(()=>({hashes:window.hashes,metrics:window.session.metrics,progress:window.progress,state:document.querySelector('[data-watch-app]').dataset.state}));
 for(const item of Object.values(report.completed.hashes))assert.equal(item.imagebitmap,item.videoframe,'Preview differs from actual encoded frame');assert.equal(report.completed.progress.fraction,1);assert.equal(report.completed.state,'complete');
 await page.evaluate(async()=>{await window.session.destroy();window.session=null;window.gc?.();});await page.waitForTimeout(1500);report.workersAfterDestroy=page.workers().length;
 // @mediabunny/ac3 intentionally caches one shared browser worker. Its decoder
 // contexts must close, and repeated sessions must not grow the cache (separate lifecycle test).
 report.effectWorkersAfterDestroy=page.workers().filter(w=>w.url().includes('effect-worker')).length;assert.equal(report.effectWorkersAfterDestroy,0);assert(report.workersAfterDestroy<=1);assert.deepEqual(report.errors,[]);assert(report.uploads.every(x=>x.bytes<10000));
 console.log(name+' ORIGINAL PASS '+JSON.stringify({openMs:report.openMs,exportMs:report.exportMs,bytes:report.outputBytes,metrics:report.completed.metrics}));
 }
}finally{await fs.writeFile(path.join(out,`${name}-original.json`),JSON.stringify(report,null,2));await browser.close();}
