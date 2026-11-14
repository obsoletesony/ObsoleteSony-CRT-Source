import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const report=[];
try{
 const page=await browser.newPage({acceptDownloads:true});await page.addInitScript(()=>{
  window.showSaveFilePicker=undefined;window.codecAudit={created:0,opened:0,closed:0,pending:0};
  const Native=window.Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.commands=new Map();this.isCodec=false;this.addEventListener('message',e=>{const command=this.commands.get(e.data.id);if(!command)return;this.commands.delete(e.data.id);window.codecAudit.pending--;if(e.data.success&&command==='init-decoder')window.codecAudit.opened++;if(e.data.success&&command==='close-decoder')window.codecAudit.closed++;});}postMessage(message,...args){if(message?.command?.type){if(!this.isCodec){this.isCodec=true;window.codecAudit.created++;}this.commands.set(message.id,message.command.type);window.codecAudit.pending++;}return super.postMessage(message,...args);}};
  window.addEventListener('crt-runtime-ready',()=>{const cls=window.__ObsoleteSonyCRT.CRTSession,open=cls.open;cls.open=async(...args)=>{const result=await open.apply(cls,args);window.session=result;return result;};});
 });
 await page.goto('http://127.0.0.1:4321/watch');
 for(let cycle=0;cycle<3;cycle++){
  await page.locator('#watch-file').setInputFiles(path.join(root,'mkv-media/profile-high-ac3.mkv'));await page.waitForFunction(()=>window.session&&document.querySelector('[data-watch-app]').dataset.state==='playing');await page.waitForTimeout(300);await page.locator('#watch-screen-action').click();
  const downloaded=page.waitForEvent('download',{timeout:120000});await page.locator('[data-watch-save]').click();await downloaded;
  await page.evaluate(async()=>{await window.session.destroy();window.session=null;});
  await page.waitForFunction(()=>window.codecAudit.opened===window.codecAudit.closed&&window.codecAudit.pending===0,{},{timeout:10000});
  const audit=await page.evaluate(()=>window.codecAudit);const workers=page.workers().map(w=>w.url());assert.equal(audit.created,1);assert.equal(audit.opened,audit.closed);assert.equal(workers.length,1);assert(!workers.some(url=>url.includes('effect-worker')));
  report.push({cycle,...audit,workers:workers.length,effectWorkers:0});
 }
 await fs.writeFile(path.join(root,'mkv-evidence/codec-lifecycle.json'),JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}
