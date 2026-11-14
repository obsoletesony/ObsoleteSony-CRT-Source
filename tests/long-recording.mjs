import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),output=path.resolve(process.env.CRT_EVIDENCE??path.join(root,'implementation-evidence'));
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CRT_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--js-flags=--expose-gc']});
const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const report={browser:browser.version(),errors,memory:[]};
await page.addInitScript(()=>{
 window.showSaveFilePicker=undefined;window.progress=[];
 window.addEventListener('watch:export-progress',event=>{window.latest=event.detail;window.progress.push(event.detail);});
 window.addEventListener('crt-runtime-ready',()=>{
  const runtime=window.__ObsoleteSonyCRT,open=runtime.CRTSession.open;
  runtime.CRTSession.open=async(...args)=>{const session=await open.apply(runtime.CRTSession,args);window.session=session;return session;};
 });
});
const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
try {
 await page.goto(process.env.CRT_SITE??'http://127.0.0.1:4321/watch');
 await page.locator('#watch-file').setInputFiles(process.env.CRT_LONG_MEDIA??path.join(root,'implementation-media/long-sync.mp4'));
 await page.waitForFunction(()=>!!window.session,{},{timeout:120000});
 await page.evaluate(()=>window.session.pause());
 report.previews=await page.evaluate(async()=>{
  const session=window.session,runtime=window.__ObsoleteSonyCRT,pool=session.pool;
  const chosen=new Map([['stable',30],['last',17985]]);
  for(let i=30;i<18000;i++){const state=runtime.stateAt(i/30,i,session.seed);if(!chosen.has(state))chosen.set(state,i);}
  if(!chosen.has('worn')||!chosen.has('tracking'))throw new Error('Long fixture does not exercise all tape states');
  window.frameHashes={};window.wanted=[...chosen.values()];
  const original=pool.processFrame.bind(pool);
  pool.processFrame=async(settings,format)=>{
   const timestamp=settings.frame.timestamp;
   const identity=pool.resolveFrame(timestamp).frameNum;
   const get=await original(settings,format);let checked=false;
   return async()=>{
    const result=await get();
    if(!checked && window.wanted.includes(identity) && (format==='imagebitmap'||format==='videoframe')) {
     checked=true;const canvas=new OffscreenCanvas(640,480),ctx=canvas.getContext('2d');ctx.drawImage(result,0,0);
     const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,640,480).data))].map(v=>v.toString(16).padStart(2,'0')).join('');
     (window.frameHashes[identity]??={})[format]=hash;
    }
    return result;
   };
  };
  const previews={};
  for(const [state,index] of chosen) {await session.seek(index/30+.00001);previews[state]={index,timestamp:session.timestamp,hash:window.frameHashes[index]?.imagebitmap};if(!previews[state].hash)throw new Error('Preview was not presented for '+index);}
  for(const [state,index] of [...chosen].reverse()){await session.seek(index/30+.00001);if(previews[state].hash!==window.frameHashes[index]?.imagebitmap)throw new Error('Seek changed frame '+index);}
  return {seed:session.seed,frames:previews,metrics:session.metrics};
 });
 console.log('Preview state/hash cases',JSON.stringify(report.previews));
 // Abort a real render, verify the partial OPFS output is removed, then render again.
 await page.locator('[data-watch-save]').click();
 await page.waitForFunction(()=>window.latest?.processedSeconds>3,{},{timeout:60000});
 await page.locator('[data-watch-cancel]').click();
 await page.waitForFunction(()=>document.querySelector('[data-watch-app]').dataset.state==='paused',{},{timeout:30000});
 report.cancel=await page.locator('#watch-status').innerText();assert.match(report.cancel,/cancelled/i);
 await page.waitForTimeout(150);
 report.partialFiles=await page.evaluate(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('obsoletesony-crt');return [...await Array.fromAsync(dir.keys())];});
 assert.equal(report.partialFiles.length,0);
 await page.evaluate(()=>{window.progress=[];window.gc?.();});
 const started=Date.now(), downloadPromise=page.waitForEvent('download',{timeout:900000});
 await page.locator('[data-watch-save]').click();
 let done=false;downloadPromise.then(()=>done=true,()=>done=true);
 while(!done) {
  await page.waitForTimeout(5000);
  const snapshot=await page.evaluate(()=>({progress:window.latest,heap:performance.memory?.usedJSHeapSize,metrics:window.session.metrics}));
  report.memory.push(snapshot);console.log('Long recording',Math.floor(snapshot.progress.fraction*100)+'%',Math.round(snapshot.heap/1048576)+' MiB JS heap');
 }
 const download=await downloadPromise;await download.saveAs(path.join(output,'chrome-long-600s.mp4'));
 report.renderMs=Date.now()-started;report.bytes=(await fs.stat(path.join(output,'chrome-long-600s.mp4'))).size;
 report.completed=await page.evaluate(()=>({hashes:window.frameHashes,metrics:window.session.metrics,progressCount:window.progress.length,last:window.latest,state:document.querySelector('[data-watch-app]').dataset.state}));
 for(const values of Object.values(report.completed.hashes))assert.equal(values.imagebitmap,values.videoframe,'Preview pixels differ from actual encoder input');
 assert.equal(report.completed.last.fraction,1);assert.equal(report.completed.state,'complete');assert(report.completed.progressCount>=18000);
 await page.evaluate(async()=>{await window.session.destroy();window.session=null;window.gc?.();});
 await page.waitForTimeout(1000);report.workersAfterDestroy=page.workers().length;assert.equal(report.workersAfterDestroy,0);
 report.finalHeap=(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('LONG PASS',JSON.stringify({renderMs:report.renderMs,bytes:report.bytes,parity:report.completed.hashes,metrics:report.completed.metrics}));
} finally {await fs.writeFile(path.join(output,'long-recording.json'),JSON.stringify(report,null,2));await browser.close();}
