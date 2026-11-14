import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve(process.argv[2]??'../mkv-media');fs.mkdirSync(out,{recursive:true});
const ffmpeg=process.env.FFMPEG??'ffmpeg';
function run(args){const p=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit',windowsHide:true});if(p.status!==0)throw new Error(`FFmpeg exited ${p.status}`);}
const input=['-f','lavfi','-i','testsrc2=size=640x480:rate=30:duration=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3'];
for(const [name,streams] of [
 ['aac',['-map','0:v','-map','1:a','-c:a','aac']],
 ['ac3-aac',['-map','0:v','-map','1:a','-map','2:a','-c:a:0','ac3','-c:a:1','aac']],
 ['ac3',['-map','0:v','-map','1:a','-c:a','ac3']],
 ['eac3',['-map','0:v','-map','1:a','-c:a','eac3']],
 ['dts',['-map','0:v','-map','1:a','-c:a','dca','-strict','-2']],
 ['opus',['-map','0:v','-map','1:a','-c:a','libopus']],
]) run([...input,...streams,'-c:v','libx264','-preset','ultrafast','-crf','24',path.join(out,`${name}.mkv`)]);
run([...input,'-map','0:v','-map','1:a','-c:v','mpeg4','-c:a','aac',path.join(out,'mpeg4.mkv')]);
run(['-i',path.join(out,'aac.mkv'),'-c','copy','-output_ts_offset','2',path.join(out,'delayed.mkv')]);
if(process.env.CRT_LONG==='1')run(['-stream_loop','449','-i',path.join(out,'aac.mkv'),'-c','copy',path.join(out,'long-1350s.mkv')]);
if(process.env.CRT_SYNC_MP4){
 run(['-i',path.resolve(process.env.CRT_SYNC_MP4),'-c','copy',path.join(out,'long-sync.mkv')]);
 run(['-i',path.resolve(process.env.CRT_SYNC_MP4),'-t','3','-c:v','copy','-c:a','ac3',path.join(out,'ac3-sync.mkv')]);
}
console.log(`Synthetic MKV fixtures: ${out}`);
