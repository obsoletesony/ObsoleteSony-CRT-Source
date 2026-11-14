import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),evidence=path.join(root,'mkv-evidence'),report=[];
for(const browserName of ['chrome','edge']) {
 const browser=await chromium.launch({executablePath:browserName==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try {
  const cases=JSON.parse(await fs.readFile(path.join(evidence,`${browserName}-after.json`))).cases.filter(c=>c.exportMs).map(c=>({file:`${browserName}-${c.name}.mp4`,hasAudio:c.metadata.hasAudio,seek:c.name==='delayed.mkv'?2.2:.1}));
  cases.push({file:'long/chrome-long-600s.mp4',hasAudio:true,seek:599});
  for(const item of cases) {
   const page=await browser.newPage();
   try {
    await page.goto('http://127.0.0.1:4321/');
    await page.setContent('<input type="file"><video></video>');
    await page.locator('input').setInputFiles(path.join(evidence,item.file));
    const actual=await page.evaluate(async({seek})=>{
     const video=document.querySelector('video'),audio=new AudioContext(),analyser=audio.createAnalyser();
     audio.createMediaElementSource(video).connect(analyser);analyser.connect(audio.destination);
     const ready=new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error(video.error?.message));});
     video.src=URL.createObjectURL(document.querySelector('input').files[0]);await ready;video.currentTime=seek;
     await new Promise(resolve=>video.onseeked=resolve);await audio.resume();await video.play();
     let maxRms=0;const data=new Float32Array(analyser.fftSize);
     const deadline=performance.now()+5000,start=performance.now();
     while(performance.now()<deadline){await new Promise(resolve=>setTimeout(resolve,20));analyser.getFloatTimeDomainData(data);maxRms=Math.max(maxRms,Math.sqrt(data.reduce((a,v)=>a+v*v,0)/data.length));if(performance.now()-start>=500&&video.currentTime>seek+.2)break;}
     const result={width:video.videoWidth,height:video.videoHeight,duration:video.duration,currentTime:video.currentTime,maxRms,decodedFrames:video.getVideoPlaybackQuality().totalVideoFrames,error:video.error?.message??null};
     video.pause();URL.revokeObjectURL(video.src);await audio.close();return result;
    },item);
    console.log({browser:browserName,file:item.file,...actual});
    assert.deepEqual([actual.width,actual.height],[640,480]);assert(actual.currentTime>item.seek+.2,`${browserName} ${item.file}: ${JSON.stringify(actual)}`);assert(actual.decodedFrames>2);assert.equal(actual.error,null);
    assert(item.hasAudio?actual.maxRms>.001:actual.maxRms===0,`Unexpected audio energy: ${item.file}`);
    report.push({browser:browserName,version:browser.version(),...item,...actual});
   } finally {await page.close();}
  }
 } finally {await browser.close();}
}
await fs.writeFile(path.join(evidence,'export-playback.json'),JSON.stringify(report,null,2));console.log(`Played ${report.length} real exported MP4s in Chrome/Edge; decoded video and Web Audio energy verified.`);
