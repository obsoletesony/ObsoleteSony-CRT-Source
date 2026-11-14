import {Input,BlobSource,ALL_FORMATS,EncodedPacketSink} from 'mediabunny';
import {openAsBlob} from 'node:fs';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),source=path.join(root,'mkv-media/long-sync.mkv'),dest=path.resolve(process.env.CRT_AUDIO_EXPORT??path.join(root,'mkv-evidence/long/chrome-long-600s.mp4'));
async function packets(file){const input=new Input({source:new BlobSource(await openAsBlob(file)),formats:ALL_FORMATS});try{const track=await input.getPrimaryAudioTrack(),result=[];for await(const p of new EncodedPacketSink(track).packets())result.push({timestamp:p.timestamp,hash:createHash('sha256').update(p.data).digest('hex')});return result;}finally{input.dispose();}}
const a=await packets(source),b=await packets(dest);assert.equal(a.length,b.length);for(let i=0;i<a.length;i++){assert.equal(a[i].hash,b[i].hash);assert(Math.abs(a[i].timestamp-b[i].timestamp)<1/48000);}
const ffmpeg=process.env.FFMPEG??path.join(root,'tools/imageio/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe');
function pcm(file,second){const r=spawnSync(ffmpeg,['-v','error','-i',file,'-ss',String(second),'-t','1','-vn','-ac','1','-ar','48000','-f','f32le','-'],{maxBuffer:2*1024*1024,windowsHide:true});if(r.status)throw new Error(String(r.stderr));return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset,r.stdout.byteOffset+r.stdout.byteLength));}
const sync=[];
for(const second of [0,300,599]){
 const x=pcm(source,second),y=pcm(dest,second);let best={error:Infinity,lag:Infinity};
 for(let lag=-96;lag<=96;lag++){let squared=0,energy=0;for(let i=Math.max(0,-lag);i<Math.min(x.length,y.length-lag);i++){squared+=(x[i]-y[i+lag])**2;energy+=x[i]**2;}const error=Math.sqrt(squared/energy);if(error<best.error)best={error,lag};}
 // Matroska timestamps in this fixture are quantized to 1 ms. This explicitly
 // rejects the prior 21 ms CodecDelay/encoder error while allowing that timebase.
 assert(Math.abs(best.lag)<=48,`${second}s exceeds one Matroska tick: ${best.lag}`);assert(best.error<1e-6,`${second}s audio content differs: ${best.error}`);
 const sourceOnset=x.findIndex(v=>Math.abs(v)>.005)/48000,exportOnset=y.findIndex(v=>Math.abs(v)>.005)/48000;
 assert(sourceOnset>=0&&exportOnset>=0&&Math.abs(sourceOnset-exportOnset)<=.001,'Lost initial audible samples');
 sync.push({second,lagSamples:best.lag,lagMs:best.lag/48,alignedPcmError:best.error,sourceOnset,exportOnset});
}
assert(Math.abs(sync[1].lagSamples-sync[2].lagSamples)<=1,'Accumulating A/V drift');
const report={identicalAudioPackets:a.length,firstTimestamp:a[0].timestamp,lastTimestamp:a.at(-1).timestamp,sync};await fs.writeFile(path.join(root,'mkv-evidence/long-audio.json'),JSON.stringify(report,null,2));console.log(report);
