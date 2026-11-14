import {chromium} from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),name=process.env.CRT_BROWSER??'chrome';
const browser=await chromium.launch({executablePath:name==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
 await page.addInitScript(()=>{window.events=[];window.addEventListener('watch:diagnostic',e=>window.events.push(e.detail));});
 await page.goto(process.env.CRT_SITE??'http://127.0.0.1:4321/watch');
 await page.locator('#watch-file').setInputFiles(path.join(root,'mkv-media/long-1350s.mkv'));
 await page.waitForFunction(()=>window.events.some(e=>e.stage==='indexing'&&e.state==='progress'));
 const start=Date.now();await page.locator('[data-watch-cancel]').click();await page.waitForFunction(()=>document.querySelector('[data-watch-app]').dataset.state==='idle');
 const cancelMs=Date.now()-start;assert(cancelMs<5000);assert.equal(page.workers().length,0);
 await page.evaluate(()=>window.events=[]);
 await page.locator('#watch-file').setInputFiles(path.join(root,'mkv-media/long-1350s.mkv'));
 await page.waitForFunction(()=>window.events.some(e=>e.stage==='indexing'&&e.state==='progress'));
 await page.locator('#watch-file').setInputFiles(path.join(root,'mkv-media/aac.mkv'));
 await page.waitForFunction(()=>document.querySelector('[data-watch-app]').dataset.state==='playing');
 const ready=await page.evaluate(()=>window.events.filter(e=>e.stage==='ready'));assert.equal(ready.length,1);assert.equal(ready[0].details.frameCount,90);
 assert.equal(errors.length,0);
 const report={browser:browser.version(),cancelMs,replacement:true,errors};await fs.writeFile(path.join(root,`mkv-evidence/${name}-lifecycle.json`),JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}
