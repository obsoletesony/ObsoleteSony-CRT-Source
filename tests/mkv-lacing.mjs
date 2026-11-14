// Synthetic AC-3 laces with the original file's 15 ms timestamp discontinuity.
// Only generated tone packets are used; no user media is included.
import {Input, BlobSource, ALL_FORMATS, EncodedPacketSink} from 'mediabunny';
import {openAsBlob} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..');
const ffprobe=process.env.FFPROBE??path.join(root,'tools/ffprobe/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const source=new Input({source:new BlobSource(await openAsBlob(path.join(root,'mkv-media/profile-high-ac3.mkv'))),formats:ALL_FORMATS});
const packets=[];
try {for await(const packet of new EncodedPacketSink(await source.getPrimaryAudioTrack()).packets()){packets.push(Buffer.from(packet.data));if(packets.length===8)break;}} finally {source.dispose();}
assert.equal(packets.length,8);assert(packets.every(p=>p.length===packets[0].length));
function vint(n){for(let bytes=1;bytes<=8;bytes++)if(n<2**(7*bytes)-1){const b=Buffer.alloc(bytes);let value=BigInt(n)|(1n<<BigInt(7*bytes));for(let i=bytes-1;i>=0;i--){b[i]=Number(value&255n);value>>=8n;}return b;}throw new Error('Element too large');}
function element(id,...parts){const data=Buffer.concat(parts);return Buffer.concat([Buffer.from(id,'hex'),vint(data.length),data]);}
function uint(id,n){let hex=n.toString(16);if(hex.length%2)hex='0'+hex;return element(id,Buffer.from(hex,'hex'));}
function lace(time,frames){const header=Buffer.alloc(5);header[0]=0x81;header.writeInt16BE(time,1);header[3]=0x84;header[4]=frames.length-1;return element('a3',header,...frames);}
const rate=Buffer.alloc(8);rate.writeDoubleBE(48000);
const fixture=Buffer.concat([
 element('1a45dfa3',uint('4286',1),uint('42f7',1),uint('42f2',4),uint('42f3',8),element('4282',Buffer.from('matroska')),uint('4287',4),uint('4285',2)),
 element('18538067',element('1549a966',uint('2ad7b1',1000000)),
  element('1654ae6b',element('ae',uint('d7',1),uint('73c5',1),uint('83',2),element('86',Buffer.from('A_AC3')),uint('23e383',32000000),element('e1',element('b5',rate),uint('9f',2)))),
  element('1f43b675',uint('e7',0),lace(0,packets.slice(0,6)),lace(207,packets.slice(6))))
]);
const file=path.join(root,'mkv-media/ac3-laced-gap.mkv');await fs.writeFile(file,fixture);
const probe=spawnSync(ffprobe,['-v','error','-show_packets','-show_entries','packet=pts_time,duration_time','-of','json',file],{windowsHide:true});assert.equal(probe.status,0,String(probe.stderr));
const expected=[0,.032,.064,.096,.128,.160,.207,.239];
const reference=JSON.parse(probe.stdout).packets.map(p=>Number(p.pts_time));assert.deepEqual(reference,expected);
const input=new Input({source:new BlobSource(await openAsBlob(file)),formats:ALL_FORMATS}),actual=[];
try {for await(const packet of new EncodedPacketSink(await input.getPrimaryAudioTrack()).packets()){const i=actual.length;assert.deepEqual(Buffer.from(packet.data),packets[i]);assert(Math.abs(packet.timestamp-expected[i])<1e-9,`Lace ${i}: ${packet.timestamp} != ${expected[i]}`);assert(Math.abs(packet.duration-.032)<1e-9);actual.push(packet.timestamp);}} finally {input.dispose();}
assert.deepEqual(actual,expected);
const report={fixture:'ac3-laced-gap.mkv',bytes:fixture.length,codec:'ac3',channels:2,sampleRate:48000,declaredFrameDurationMs:32,gapMs:15,packets:actual.length,expected,reference,actual,payloadsIdentical:true};
await fs.mkdir(path.join(root,'mkv-evidence'),{recursive:true});await fs.writeFile(path.join(root,'mkv-evidence/lacing.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
