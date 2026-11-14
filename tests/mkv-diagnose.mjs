import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const browserName=process.env.CRT_BROWSER??'chrome';
const browser=await chromium.launch({executablePath:browserName==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();
const report={browser:browserName,version:browser.version(),cases:[]};
try {
 await page.goto('http://127.0.0.1:5186/package.json');
 await page.evaluate(()=>{document.body.innerHTML='<input type="file"><canvas></canvas>';});
 for(const name of (process.env.CRT_CASES??'aac.mkv,ac3-aac.mkv,ac3.mkv,opus.mkv,delayed.mkv,mpeg4.mkv').split(',')) {
  await page.locator('input').setInputFiles(path.join(root,'mkv-media',name));
  const result=await page.evaluate(async()=>{
   const {Input,ALL_FORMATS,BlobSource,VideoSampleSink,AudioBufferSink}=await import('/node_modules/mediabunny/dist/modules/src/index.js');
   const {indexFrames}=await import('/src/crt/frame-index.ts');
   const {CRTSession}=await import('/src/crt/index.ts');
   const file=document.querySelector('input').files[0], data={bytes:file.size,stages:[],tracks:[]};
   async function stage(name,fn){const start=performance.now();try{const value=await fn();data.stages.push({stage:name,ms:performance.now()-start,ok:true,value});return value;}catch(e){data.stages.push({stage:name,ms:performance.now()-start,ok:false,error:String(e)});}}
   const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
   try {
    await stage('container',async()=>{for(const t of await input.getTracks())data.tracks.push({type:t.type,id:t.id,codec:await t.getCodec(),internal:await t.getInternalCodecId(),config:await t.getCodecParameterString(),start:await t.getFirstTimestamp()});});
    await stage('index',async()=>{const timestamps=await indexFrames(file);return {count:timestamps.length,first:timestamps[0],last:timestamps.at(-1)};});
    const video=await input.getPrimaryVideoTrack();
    await stage('video-capability',()=>video.canDecode());
    await stage('frame-at-zero',async()=>{const f=await new VideoSampleSink(video).getSample(0);const stamp=f?.timestamp;f?.close();return stamp??null;});
    await stage('first-frame',async()=>{const f=await new VideoSampleSink(video).getSample(Math.max(0,await video.getFirstTimestamp()));const stamp=f?.timestamp;f?.close();return stamp??null;});
    for(const track of await input.getAudioTracks()) await stage(`audio-${track.id}`,async()=>{const canDecode=await track.canDecode();const b=await new AudioBufferSink(track).getBuffer(Math.max(0,await track.getFirstTimestamp()));return {canDecode,timestamp:b?.timestamp};});
    await stage('CRTSession.open/play',async()=>{let session;try{session=await CRTSession.open(file,document.querySelector('canvas'));let error;session.addEventListener('error',e=>error=e.message);await session.play();await new Promise(r=>setTimeout(r,500));if(error)throw new Error(error);return session.metadata;}finally{await session?.destroy();}});
    await stage('native-video',async()=>{const v=document.createElement('video'),url=URL.createObjectURL(file);v.src=url;document.body.append(v);try{await Promise.race([v.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Native playback timeout')),5000))]);await new Promise(r=>setTimeout(r,250));return {width:v.videoWidth,height:v.videoHeight,time:v.currentTime};}finally{v.pause();v.removeAttribute('src');v.load();v.remove();URL.revokeObjectURL(url);}});
   } finally{input.dispose();}
   return data;
  });
  report.cases.push({name,...result});console.log(JSON.stringify({name,...result}));
 }
} finally {await fs.mkdir(path.join(root,'mkv-evidence'),{recursive:true});await fs.writeFile(path.join(root,'mkv-evidence',`${browserName}-${process.env.CRT_REPORT_TAG??'diagnosis'}.json`),JSON.stringify(report,null,2));await browser.close();}
