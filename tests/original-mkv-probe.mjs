// Local evidence only. Never save movie frames, trace bodies or source media.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const file=process.env.CRT_ORIGINAL_FILE;if(!file)throw new Error('CRT_ORIGINAL_FILE is required');
const root=path.resolve(import.meta.dirname,'../..'),evidence=path.join(root,'original-mkv-evidence');await fs.mkdir(evidence,{recursive:true});
for(const name of ['chrome','edge']){
 const browser=await chromium.launch({executablePath:name==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5186/package.json');await page.setContent('<input type="file"><canvas></canvas>');await page.locator('input').setInputFiles(file);
  const result=await page.evaluate(async()=>{
   const {Input,ALL_FORMATS,BlobSource,VideoSampleSink,AudioBufferSink,EncodedPacketSink}=await import('/node_modules/mediabunny/dist/modules/src/index.js');
   const file=document.querySelector('input').files[0],input=new Input({source:new BlobSource(file),formats:ALL_FORMATS}),result={bytes:file.size,stages:[]};
   async function stage(name,fn){const at=performance.now();try{const value=await fn();result.stages.push({name,ms:performance.now()-at,ok:true,value});return value;}catch(error){result.stages.push({name,ms:performance.now()-at,ok:false,error:String(error)});}}
   try{
    await stage('container',async()=>Promise.all((await input.getTracks()).map(async t=>({type:t.type,id:t.id,codec:await t.getCodec(),internal:await t.getInternalCodecId(),start:await t.getFirstTimestamp()}))));
    const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
    await stage('full-file-index',async()=>{let count=0;for await(const p of new EncodedPacketSink(video).packets(undefined,undefined,{metadataOnly:true}))count++;return count;});
    await stage('video-canDecode',()=>video.canDecode());
    await stage('first-video-frame',async()=>{const f=await new VideoSampleSink(video).getSample(0);const data={timestamp:f?.timestamp,width:f?.displayWidth,height:f?.displayHeight};f?.close();return data;});
    await stage('audio-canDecode',()=>audio.canDecode());
    await stage('first-audio-buffer',async()=>{const b=await new AudioBufferSink(audio).getBuffer(0);return {timestamp:b?.timestamp,frames:b?.buffer.length};});
   }finally{input.dispose();}
   await stage('legacy-1.0.0-processed-playback',async()=>{const {CRTSession}=await import('/package/crt-1.0.0/crt.js');let session;try{session=await CRTSession.open(file,document.querySelector('canvas'));let error;session.addEventListener('error',e=>error=e.message);await session.play();await new Promise(r=>setTimeout(r,1200));if(error)throw new Error(error);return {state:session.state,time:session.timestamp,metadata:session.metadata};}finally{await session?.destroy();}});
   await stage('native-video',async()=>{const video=document.createElement('video'),url=URL.createObjectURL(file);video.src=url;document.body.append(video);try{await video.play();await new Promise(r=>setTimeout(r,500));return {width:video.videoWidth,height:video.videoHeight,time:video.currentTime};}finally{video.pause();video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url);}});
   return result;
  });
  const report={browser:name,version:browser.version(),...result};await fs.writeFile(path.join(evidence,`${name}-before.json`),JSON.stringify(report,null,2));console.log(report);
 }finally{await browser.close();}
}
