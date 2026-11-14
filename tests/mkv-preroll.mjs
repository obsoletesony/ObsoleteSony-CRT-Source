// Fast container-level regression: keep all AAC packets, including negative preroll.
import {Input,BlobSource,ALL_FORMATS,EncodedPacketSink,Output,Mp4OutputFormat,BufferTarget,EncodedAudioPacketSource} from 'mediabunny';
import {openAsBlob} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..');
const input=new Input({source:new BlobSource(await openAsBlob(path.join(root,'mkv-media/long-sync.mkv'))),formats:ALL_FORMATS});
try {
 const track=await input.getPrimaryAudioTrack();assert.equal(track.codec,'aac');
 assert(Math.abs(await track.getFirstTimestamp()+1024/48000)<1e-8,'Matroska CodecDelay was not applied');
 const sink=new EncodedPacketSink(track),target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target}),source=new EncodedAudioPacketSource('aac');
 output.addAudioTrack(source);await output.start();const config={decoderConfig:await track.getDecoderConfig()};let count=0;
 for await(const packet of sink.packets()){await source.add(packet,config);count++;}
 await output.finalize();await fs.writeFile(path.join(root,'mkv-evidence/preroll-audio.mp4'),new Uint8Array(target.buffer));
 console.log({packets:count,firstTimestamp:await track.getFirstTimestamp(),bytes:target.buffer.byteLength});
}finally{input.dispose();}
