// Metadata, decoded-audio alignment and native playback only; no media leaves this computer.
import {chromium} from 'playwright';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const source=process.env.CRT_ORIGINAL_FILE;if(!source)throw new Error('CRT_ORIGINAL_FILE is required');
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'original-mkv-evidence');
const ffprobe=process.env.FFPROBE??path.join(root,'tools/ffprobe/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'),ffmpeg=process.env.FFMPEG??path.join(root,'tools/imageio/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe');
function run(exe,args){const p=spawnSync(exe,args,{windowsHide:true,maxBuffer:4*1024*1024});if(p.status)throw new Error(String(p.stderr));return p.stdout;}
function metadata(file){return JSON.parse(run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',file]));}
// Raw PCM alone discards timestamp gaps. The original has a 15 ms discontinuity
// near 616.768 s; reconstruct each presentation timeline before comparing sync.
function pcm(file,second){const p=run(ffmpeg,['-v','error','-i',file,'-af','aresample=async=1:first_pts=0','-ss',String(second),'-t','2','-vn','-ac','1','-ar','48000','-f','f32le','-']);return new Float32Array(p.buffer.slice(p.byteOffset,p.byteOffset+p.byteLength));}
const input=metadata(source),results=[];
assert.equal(Number(input.format.size),409432817,'This is not the reported original file size');
const sourcePackets=JSON.parse(run(ffprobe,['-v','error','-count_packets','-select_streams','v:0','-show_entries','stream=nb_read_packets','-of','json',source]));
assert.equal(Number(sourcePackets.streams[0].nb_read_packets),31087,'Independent source frame count differs');
for(const name of ['chrome','edge']){
 const file=path.join(out,`${name}-original-processed.mp4`),meta=metadata(file),video=meta.streams.find(s=>s.codec_type==='video'),audio=meta.streams.find(s=>s.codec_type==='audio');
 assert.equal(video.codec_name,'h264');assert.equal(video.width,640);assert.equal(video.height,480);assert.equal(video.sample_aspect_ratio,'1:1');assert.equal(Number(video.nb_frames),31087);
 assert.equal(audio.codec_name,'aac');assert.equal(audio.channels,2);assert.equal(Number(audio.sample_rate),48000);assert(Math.abs(Number(meta.format.duration)-Number(input.format.duration))<.08);
 run(ffmpeg,['-v','error','-xerror','-i',file,'-map','0:v:0','-map','0:a:0','-f','null','-']);
 const result={browser:name,video:{codec:video.codec_name,width:video.width,height:video.height,frames:Number(video.nb_frames),rate:video.avg_frame_rate},audio:{codec:audio.codec_name,channels:audio.channels,sampleRate:audio.sample_rate},duration:Number(meta.format.duration),bytes:Number(meta.format.size),sync:[],playback:[]};
 result.fullDecodePassed=true;
 for(const second of [60,600,1280]){
  const x=pcm(source,second),y=pcm(file,second);let best={correlation:-Infinity,lag:Infinity,gain:0};
  for(let lag=-2048;lag<=2048;lag++){let xx=0,yy=0,xy=0;for(let i=Math.max(0,-lag);i<Math.min(x.length,y.length-lag);i+=8){xx+=x[i]*x[i];yy+=y[i+lag]*y[i+lag];xy+=x[i]*y[i+lag];}const correlation=xy/Math.sqrt(xx*yy);if(correlation>best.correlation)best={correlation,lag,gain:xy/xx};}
  result.sync.push({second,lagSamples:best.lag,lagMs:best.lag/48,correlation:best.correlation,gain:best.gain});console.log(name+' audio sync',result.sync.at(-1));
  assert(Math.abs(best.lag)<=48,`${name} ${second}s audio exceeds 1 ms`);assert(best.correlation>.9,`${name} ${second}s audio content mismatch`);
 }
 const browser=await chromium.launch({executablePath:name==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:4321/');await page.setContent('<input type="file"><video></video>');await page.locator('input').setInputFiles(file);
  result.playback=await page.evaluate(async()=>{
   const video=document.querySelector('video'),audio=new AudioContext(),analyser=audio.createAnalyser();audio.createMediaElementSource(video).connect(analyser);analyser.connect(audio.destination);
   const ready=new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error(video.error?.message));});video.src=URL.createObjectURL(document.querySelector('input').files[0]);await ready;await audio.resume();const checks=[];
   for(const time of [60,600,video.duration-10]){video.pause();const seek=new Promise(resolve=>video.onseeked=resolve);video.currentTime=time;await seek;await video.play();const start=performance.now(),deadline=start+6000,data=new Float32Array(analyser.fftSize);let maxRms=0;while(performance.now()<deadline){await new Promise(r=>setTimeout(r,20));analyser.getFloatTimeDomainData(data);maxRms=Math.max(maxRms,Math.sqrt(data.reduce((a,v)=>a+v*v,0)/data.length));if(performance.now()-start>1500&&video.currentTime>time+.5)break;}checks.push({requested:time,time:video.currentTime,width:video.videoWidth,height:video.videoHeight,maxRms,decodedFrames:video.getVideoPlaybackQuality().totalVideoFrames,error:video.error?.message??null});}
   video.pause();URL.revokeObjectURL(video.src);await audio.close();return checks;
  });
  for(const item of result.playback){assert.deepEqual([item.width,item.height],[640,480]);assert(item.time>item.requested+.5);assert(item.maxRms>.0001);assert.equal(item.error,null);}
 }finally{await browser.close();}
 results.push(result);
}
await fs.writeFile(path.join(out,'verified-original-exports.json'),JSON.stringify(results,null,2));console.log('Both complete original-file exports verified: 31,087 processed frames, stereo AAC, audio sync and native browser playback.');
