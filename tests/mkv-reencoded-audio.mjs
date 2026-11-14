import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),ffmpeg=process.env.FFMPEG??path.join(root,'tools/imageio/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe');
function pcm(file,second){const r=spawnSync(ffmpeg,['-v','error','-i',file,'-ss',String(second),'-t','0.9','-vn','-ac','1','-ar','48000','-f','f32le','-'],{windowsHide:true,maxBuffer:2*1024*1024});if(r.status)throw new Error(String(r.stderr));return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset,r.stdout.byteOffset+r.stdout.byteLength));}
const report=[];
for(const browser of ['chrome','edge'])for(const second of [0,1,2]) {
 const x=pcm(path.join(root,'mkv-media/ac3-sync.mkv'),second),y=pcm(path.join(root,`mkv-evidence/${browser}-ac3-sync.mkv.mp4`),second);let best={error:Infinity,lag:Infinity};
 for(let lag=-1600;lag<=1600;lag++){let error=0,energy=0;for(let i=Math.max(0,-lag);i<Math.min(x.length,y.length-lag);i+=8){error+=(x[i]-y[i+lag])**2;energy+=x[i]**2;}error=Math.sqrt(error/energy);if(error<best.error)best={error,lag};}
 const item={browser,second,lagSamples:best.lag,lagMs:best.lag/48,alignedPcmError:best.error};report.push(item);console.log(item);
}
await fs.writeFile(path.join(root,'mkv-evidence/reencoded-audio.json'),JSON.stringify(report,null,2));
for(const item of report){assert(Math.abs(item.lagSamples)<=48,'Re-encoded audio exceeds one Matroska tick');assert(item.alignedPcmError<.1,'Re-encoded audio differs excessively');}
