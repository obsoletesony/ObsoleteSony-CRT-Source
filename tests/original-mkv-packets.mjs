// Compare the permitted local original with an independent demuxer. Never save payloads.
import {Input, BlobSource, ALL_FORMATS, EncodedPacketSink} from 'mediabunny';
import {openAsBlob} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const file=process.env.CRT_ORIGINAL_FILE;if(!file)throw new Error('CRT_ORIGINAL_FILE is required');
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'original-mkv-evidence');
const ffprobe=process.env.FFPROBE??path.join(root,'tools/ffprobe/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const probe=spawnSync(ffprobe,['-v','error','-select_streams','a:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,data_hash','-of','json',file],{windowsHide:true,maxBuffer:20*1024*1024});assert.equal(probe.status,0,String(probe.stderr));
const reference=JSON.parse(probe.stdout).packets,input=new Input({source:new BlobSource(await openAsBlob(file)),formats:ALL_FORMATS});
const report={referenceCount:reference.length,parserCount:0,differentPayloads:0,maxTimestampDelta:0};
try {for await(const packet of new EncodedPacketSink(await input.getPrimaryAudioTrack()).packets()){
 const expected=reference[report.parserCount++];assert(expected,'Parser emitted an extra packet');
 report.maxTimestampDelta=Math.max(report.maxTimestampDelta,Math.abs(packet.timestamp-Number(expected.pts_time)));
 if(createHash('sha256').update(packet.data).digest('hex')!==expected.data_hash.split(':')[1].toLowerCase())report.differentPayloads++;
}} finally {input.dispose();}
await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'packet-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
assert.equal(report.parserCount,report.referenceCount);assert.equal(report.differentPayloads,0);assert(report.maxTimestampDelta<1e-9);
