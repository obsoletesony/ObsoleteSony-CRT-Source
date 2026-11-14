import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {profiles,validatePreset,stateAt,settingsAt,clipSeed} from '../src/crt/profiles.ts';
import {getWatchCrop43} from '../src/crt/crop.ts';
import {frameIndexAt} from '../src/crt/frame-index.ts';
test('VFR frame identity follows presentation timestamps, independent of processing order',()=>{
 const stamps=Float64Array.from([0,33333,100000,166666,200000,300000]);
 for(const i of [5,1,3,0,2,4]){assert.equal(frameIndexAt(stamps,stamps[i]),i);assert.equal(frameIndexAt(stamps,stamps[i]+1),i);}
 assert.throws(()=>frameIndexAt(stamps,250000));
});
test('golden profile is exactly the generated native baseline, with recorded hash',async()=>{
 const file=await fs.readFile(new URL('../presets/v1/upstream-default.json',import.meta.url));
 const provenance=JSON.parse(await fs.readFile(new URL('../presets/v1/provenance.json',import.meta.url)));
 assert.equal(createHash('sha256').update(file).digest('hex'),provenance.sha256);
 assert.deepEqual(profiles.stable,JSON.parse(file));assert.equal(Object.keys(profiles.stable).length,61);
 assert.equal(profiles.stable.vhs_chroma_vert_blend,false);assert(!('video_scanline_phase_shift' in profiles.stable));
});
test('strict native JSON validation rejects incompatible fields/types/ranges/pins',()=>{
 for(const value of [null,[],{}, {version:2},{version:1,unknown:0},{version:1,video_scanline_phase_shift:2},{version:1,chroma_noise:true,random_seed:1.2},{version:1,vhs_edge_wave:21},{version:1,use_field:100},{version:1,snow_intensity:NaN},{version:1,composite_noise_intensity:Infinity},{version:1,chroma_noise:'true'}]) assert.throws(()=>validatePreset(value));
 assert.throws(()=>validatePreset({version:1},'different-pin'));
 const custom=validatePreset({version:1,snow_intensity:.5});assert.equal(custom.snow_intensity,.5);assert.equal(custom.vhs_chroma_vert_blend,false);assert(Object.isFrozen(custom));
});
test('canonical centered crops include small, odd, portrait and invalid dimensions',()=>{
 assert.deepEqual(getWatchCrop43(1920,1080),{x:240,y:0,width:1440,height:1080});
 assert.deepEqual(getWatchCrop43(1080,1920),{x:0,y:555,width:1080,height:810});
 assert.deepEqual(getWatchCrop43(641,481),{x:0,y:0,width:640,height:480});
 for(const [width,height] of [[NaN,480],[640,Infinity],[3,480],[640,2]])assert.throws(()=>getWatchCrop43(width,height));
});
test('schedule is seek/order independent, irregular and dominated by exact stable defaults',()=>{
 const seed=0xf304582f,counts={stable:0,worn:0,tracking:0}, states=[];
 for(let i=0;i<18000;i++){const state=stateAt(i/30,i,seed);states.push(state);counts[state]++;assert.equal(settingsAt(i/30,i,seed),profiles[state]);}
 for(let i=17999;i>=0;i--)assert.equal(stateAt(i/30,i,seed),states[i]);
 assert(counts.stable>18000*.7);assert(counts.worn>0);assert(counts.tracking>0&&counts.tracking<18000*.02);
 assert.equal(settingsAt(9,270,seed,false),profiles.stable);
 assert.notDeepEqual(states,states.map((_,i)=>stateAt(i/30,i,seed+1)));
 console.log('10-minute schedule frame counts',counts);
});
test('content seed survives file rename and is bounded for large recordings',async()=>{
 const bytes=new Uint8Array(200000).fill(23);
 assert.equal(await clipSeed(new File([bytes],'first.mp4')),await clipSeed(new File([bytes],'renamed.mp4')));
 const original=await clipSeed(new Blob([bytes]));bytes[12]=3;assert.notEqual(original,await clipSeed(new Blob([bytes])));
});
