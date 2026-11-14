import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),media=path.join(root,'mkv-media'),evidence=path.resolve(process.env.CRT_EVIDENCE??path.join(root,'mkv-evidence'));
await fs.mkdir(evidence,{recursive:true});
const browserName=process.env.CRT_BROWSER??'chrome';
const browser=await chromium.launch({executablePath:browserName==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--js-flags=--expose-gc']});
const report={browser:browserName,version:browser.version(),cases:[],errors:[],uploads:[]};
try {
 for(const name of (process.env.CRT_CASES??'aac.mkv,ac3-aac.mkv,ac3.mkv,eac3.mkv,dts.mkv,opus.mkv,delayed.mkv,profile-high-ac3.mkv,mpeg4.mkv,long-1350s.mkv').split(',')) {
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000},storageState:process.env.CRT_STORAGE_STATE}),page=await context.newPage();
  await page.addInitScript(()=>{
   window.showSaveFilePicker=undefined;window.audit={diagnostics:[],audioNodes:0,contexts:[],progress:[],openingHeap:[]};
   setInterval(()=>{if(document.querySelector('[data-watch-app]')?.dataset.state==='loading'&&performance.memory)window.audit.openingHeap.push(performance.memory.usedJSHeapSize);},25);
   const Native=window.AudioContext;window.AudioContext=class extends Native{constructor(...args){super(...args);window.audit.contexts.push(this);}createBufferSource(){window.audit.audioNodes++;return super.createBufferSource();}};
   window.addEventListener('watch:diagnostic',e=>window.audit.diagnostics.push({...e.detail,at:performance.now()}));
   window.addEventListener('watch:export-progress',e=>window.audit.progress.push(e.detail));
  });
  page.on('pageerror',error=>report.errors.push({name,error:String(error)}));
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))report.uploads.push({url:r.url(),bytes:r.postDataBuffer()?.length??0});});
  try {
   await page.goto(process.env.CRT_SITE??'http://127.0.0.1:4321/watch');await page.waitForTimeout(500);
   const start=Date.now();await page.locator('#watch-file').setInputFiles(path.join(media,name));
   await page.waitForFunction(()=>['playing','paused','ended','error'].includes(document.querySelector('[data-watch-app]').dataset.state),{},{timeout:120000});
   const initMs=Date.now()-start,state=await page.locator('[data-watch-app]').getAttribute('data-state');
   if(name==='mpeg4.mkv') {
    assert.equal(state,'error');assert.equal(await page.locator('[data-watch-osd]').innerText(),'VIDEO UNSUPPORTED');
    assert.match(await page.locator('#watch-status').innerText(),/V_MPEG4\/ISO\/ASP/);
    const diagnostic=await page.evaluate(()=>window.audit.diagnostics);assert(!diagnostic.some(d=>d.stage==='indexing'));
    report.cases.push({name,initMs,state,diagnostic});continue;
   }
   assert.notEqual(state,'error',await page.locator('#watch-status').innerText());
   await page.waitForTimeout(800);
   assert.notEqual(await page.locator('[data-watch-app]').getAttribute('data-state'),'error',await page.locator('#watch-status').innerText());
   const before=await page.evaluate(()=>({diagnostics:window.audit.diagnostics,audioNodes:window.audit.audioNodes,openingHeap:window.audit.openingHeap}));
   const meta=before.diagnostics.findLast(d=>d.stage==='ready').details;
   if(name==='dts.mkv') {assert(!meta.hasAudio);assert(meta.warnings.some(w=>w.includes('silent')));assert.equal(before.audioNodes,0);assert.match(await page.locator('[data-watch-subosd]').innerText(),/SILENT/);}
   else {assert(meta.hasAudio);assert(before.audioNodes>0,'Audio was not scheduled');}
   if(name==='delayed.mkv')assert(Math.abs(meta.duration-5.021)<.05,'Nonzero-start duration is incorrect');
   assert.deepEqual(await page.locator('#watch-video').evaluate(c=>[c.width,c.height]),[640,480]);
   if(await page.locator('[data-watch-app]').getAttribute('data-state')==='playing')await page.locator('#watch-screen-action').click();
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('watch:seek',{detail:{seconds:2.5}})));await page.waitForTimeout(100);
   const output={name,initMs,metadata:meta,audioNodes:before.audioNodes,diagnostics:before.diagnostics,openingHeap:before.openingHeap.length?{min:Math.min(...before.openingHeap),max:Math.max(...before.openingHeap),samples:before.openingHeap.length}:null};
   if(!name.startsWith('long-')) {
    const t=Date.now(),download=page.waitForEvent('download',{timeout:120000});await page.locator('[data-watch-save]').click();
    const saved=await download,file=path.join(evidence,`${browserName}-${name}.mp4`);await saved.saveAs(file);
    output.exportMs=Date.now()-t;output.bytes=(await fs.stat(file)).size;
    const progress=await page.evaluate(()=>window.audit.progress);assert.equal(progress.at(-1).fraction,1);assert(progress.some(p=>p.phase==='finalizing'));
   } else {
    await page.locator('[data-watch-save]').click();await page.waitForFunction(()=>window.audit.progress.some(p=>p.fraction>0));
    await page.locator('[data-watch-cancel]').click();await page.waitForFunction(()=>document.querySelector('[data-watch-app]').dataset.state==='paused');
    output.cancelPassed=true;
    await page.locator('#watch-file').setInputFiles(path.join(media,'aac.mkv'));await page.waitForFunction(()=>document.querySelector('[data-watch-app]').dataset.state==='playing');
    await page.locator('#watch-screen-action').click();
    const download=page.waitForEvent('download',{timeout:120000});await page.locator('[data-watch-save]').click();await (await download).saveAs(path.join(evidence,`${browserName}-retry.mp4`));
    output.retryPassed=true;
   }
   output.liveAudioContexts=await page.evaluate(()=>window.audit.contexts.filter(c=>c.state!=='closed').length);assert.equal(output.liveAudioContexts,1);
   report.cases.push(output);console.log(JSON.stringify({...output,diagnostics:undefined}));
  } finally {await context.close();}
 }
 assert.deepEqual(report.errors,[]);assert(report.uploads.every(r=>r.bytes<10000&&!/upload|video/i.test(r.url)));
} finally {await fs.writeFile(path.join(evidence,`${process.env.CRT_REPORT_TAG??browserName}-after.json`),JSON.stringify(report,null,2));await browser.close();}
