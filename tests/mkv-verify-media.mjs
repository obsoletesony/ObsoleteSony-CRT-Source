import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'mkv-evidence');
const ffprobe=process.env.FFPROBE??path.join(root,'tools/ffprobe/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const ffmpeg=process.env.FFMPEG??path.join(root,'tools/imageio/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe');
function run(exe,args){const p=spawnSync(exe,args,{windowsHide:true,maxBuffer:8*1024*1024});if(p.status!==0)throw new Error(String(p.stderr));return p.stdout;}
function metadata(file){return JSON.parse(run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',file]));}
function pcm(file,map){const data=run(ffmpeg,['-v','error','-i',file,'-ss','0.5','-t','0.25','-map',map,'-ac','1','-ar','48000','-f','f32le','-']);return new Float32Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));}
function tone(samples,frequency){let real=0,imag=0;for(let i=0;i<samples.length;i++){const phase=2*Math.PI*frequency*i/48000;real+=samples[i]*Math.cos(phase);imag+=samples[i]*Math.sin(phase);}return Math.hypot(real,imag)/samples.length;}
const report=[];
for(const browser of ['chrome','edge']) {
 const result=JSON.parse(await fs.readFile(path.join(out,`${browser}-after.json`)));
 for(const item of result.cases.filter(c=>c.exportMs)){
  const source=path.join(root,'mkv-media',item.name),file=path.join(out,`${browser}-${item.name}.mp4`),input=metadata(source),output=metadata(file);
  const video=output.streams.find(s=>s.codec_type==='video'),audio=output.streams.filter(s=>s.codec_type==='audio');
  assert.equal(video.codec_name,'h264');assert.equal(video.width,640);assert.equal(video.height,480);assert.equal(video.sample_aspect_ratio,'1:1');
  assert(Math.abs(Number(output.format.duration)-Number(input.format.duration))<.08,`${item.name}: duration mismatch`);
  assert.equal(audio.length,item.metadata.hasAudio?1:0);
  let measured;
  if(audio.length){assert.equal(audio[0].codec_name,'aac');const samples=pcm(file,'0:a:0');assert(samples.length>1000);const expected=item.name==='ac3-aac.mkv'&&item.metadata.audioTrackId===3?880:440;measured={frequency:expected,amplitude:tone(samples,expected),wrongTone:tone(samples,expected===440?880:440)};assert(measured.amplitude>.02);assert(measured.amplitude>measured.wrongTone*10,'Wrong audio track exported');}
  report.push({browser,name:item.name,input:input.streams.map(s=>({codec:s.codec_name,profile:s.profile,pixelFormat:s.pix_fmt,type:s.codec_type,start:s.start_time,sampleRate:s.sample_rate})),output:{width:video.width,height:video.height,video:video.codec_name,audio:audio[0]?.codec_name??null,duration:output.format.duration},measured});
 }
}
await fs.writeFile(path.join(out,'media-verification.json'),JSON.stringify(report,null,2));console.log(`Verified ${report.length} actual MP4s: 4:3, H.264/AAC, duration and selected audio tone.`);
