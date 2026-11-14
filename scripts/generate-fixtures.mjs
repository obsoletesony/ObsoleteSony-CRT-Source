import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const executable=process.env.FFMPEG ?? 'ffmpeg';
const out=path.resolve(process.argv[2]??'test-media');fs.mkdirSync(out,{recursive:true});
function run(args) {const result=spawnSync(executable,['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit',windowsHide:true});if(result.status)throw new Error(`FFmpeg failed: ${result.status}`);}
for(const [name,size] of [['landscape','1920x1080'],['portrait','1080x1920'],['native','640x480']]) {
    run(['-f','lavfi','-i',`testsrc2=size=${size}:rate=30:duration=3`,'-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=3','-c:v','libx264','-preset','ultrafast','-crf','24','-c:a','aac','-shortest',path.join(out,`${name}.mp4`)]);
}
run(['-display_rotation','90','-i',path.join(out,'landscape.mp4'),'-c','copy',path.join(out,'rotated.mp4')]);
run(['-i',path.join(out,'native.mp4'),'-vf',"select='if(lt(t,1),not(mod(n,2)),1)'",'-fps_mode','vfr','-c:v','libx264','-preset','ultrafast','-c:a','copy',path.join(out,'vfr.mp4')]);
run(['-f','lavfi','-i','testsrc2=size=720x480:rate=30:duration=3','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=3','-vf','setsar=8/9','-c:v','libx264','-preset','ultrafast','-crf','24','-c:a','aac','-shortest',path.join(out,'sar.mp4')]);
run(['-f','lavfi','-i','testsrc=size=641x481:rate=30:duration=3','-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=3','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-pix_fmt','yuv420p','-c:a','libopus','-shortest',path.join(out,'odd.webm')]);
run(['-f','lavfi','-i','testsrc2=size=640x480:rate=30:duration=600','-f','lavfi','-i',"aevalsrc='sin(2*PI*1000*t)*if(lt(mod(t,1),0.08),0.5,0)':s=48000:d=600",'-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,1),0.08)'",'-c:v','libx264','-preset','ultrafast','-crf','28','-c:a','aac','-shortest',path.join(out,'long-sync.mp4')]);
fs.writeFileSync(path.join(out,'corrupted.mp4'),'This is deliberately not a valid movie.');
console.log(`Created local synthetic test media in ${out}`);
