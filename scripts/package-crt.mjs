import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'package/crt-1.0.1');
const copies={
    'LICENSE':'notices/ntsc-rs-web-GPL-3.0.txt',
    'ntsc-rs-web-wrapper/LICENSE_MIT':'notices/wrapper-MIT.txt',
    'ntsc-rs-web-wrapper/LICENSE_APACHE':'notices/wrapper-Apache-2.0.txt',
    'ntsc-rs-web-wrapper/build/about.json':'notices/rust.json',
    'ntsc-rs-web-wrapper/build/setting-descriptors.ts':'setting-descriptors.ts.txt',
    'aac-codec/FFmpeg/COPYING.LGPLv2.1':'notices/FFmpeg-LGPL-2.1.txt',
    'aac-codec/FFmpeg/COPYING.LGPLv3':'notices/FFmpeg-LGPL-3.0.txt',
    'aac-codec/configure_wasm.sh':'notices/FFmpeg-configure.sh',
    'valadaptive-lib/LICENSE':'notices/valadaptive-lib-CC0.txt',
    'node_modules/@mediabunny/ac3/LICENSE':'notices/ac3-MPL-2.0.txt',
    'node_modules/@mediabunny/ac3/licenses/ffmpeg/COPYING.LGPLv2.1':'notices/ac3-FFmpeg-LGPL-2.1.txt',
    'node_modules/@mediabunny/ac3/README.md':'notices/ac3-source-and-build.md',
};
for(const [source,dest] of Object.entries(copies)) {await fs.mkdir(path.dirname(path.join(out,dest)),{recursive:true});await fs.writeFile(path.join(out,dest),(await fs.readFile(path.join(root,source),'utf8')).replaceAll('\r\n','\n'));}
await fs.cp(path.join(root,'presets'),path.join(out,'presets'),{recursive:true});
await fs.writeFile(path.join(out,'browser-entry.js'),"import * as runtime from './crt.js';\nglobalThis.__ObsoleteSonyCRT=runtime;\nglobalThis.dispatchEvent(new Event('crt-runtime-ready'));\n");
await fs.writeFile(path.join(out,'NOTICE.txt'),`ObsoleteSony CRT 1.0.1
Derived from ntsc-rs-web (GPL-3.0-or-later), copyright its contributors.
Source and build instructions: https://github.com/obsoletesony/ObsoleteSony-CRT-Source
Third-party licenses: notices/
AC-3/E-AC-3 decoding: @mediabunny/ac3 1.66.0 (MPL-2.0), FFmpeg (LGPL-2.1-or-later).
Mediabunny 1.55.7 Matroska CodecDelay and MP4 audio-preroll handling modified by ObsoleteSony; patched MPL source is in the corresponding-source repository.
Exact sources and rebuild instructions: notices/ac3-source-and-build.md and the public corresponding-source repository.
`);
async function files(dir) {let result=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})) {const p=path.join(dir,entry.name);result.push(...(entry.isDirectory()?await files(p):[p]));}return result.sort();}
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
// Build-directory paths and source checkout EOLs are not runtime inputs. Normalize them before hashing.
function portable(value) {
    if(typeof value==='string') return value.replaceAll(root,'<SOURCE_ROOT>').replaceAll(root.replaceAll('\\','/'),'<SOURCE_ROOT>').replaceAll('\r\n','\n');
    if(Array.isArray(value)) return value.map(portable);
    if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,portable(item)]));
    return value;
}
for(const file of await files(out)) if(file.endsWith('.map')||file===path.join(out,'notices/rust.json')) {
    await fs.writeFile(file,JSON.stringify(portable(JSON.parse(await fs.readFile(file,'utf8'))))+'\n');
}
const artifacts={};for(const file of await files(out)) if(path.basename(file)!=='manifest.json') {const data=await fs.readFile(file);artifacts[path.relative(out,file).replaceAll('\\','/')]={bytes:data.length,sha256:hash(data)};}
const sourceHash=async(file)=>hash((await fs.readFile(file,'utf8')).replaceAll('\r\n','\n'));
const sourceHashes={};for(const dir of ['src/crt','presets','third_party/ac3/src','third_party/ac3/patches','third_party/ac3/licenses','third_party/mediabunny']) for(const file of await files(path.join(root,dir))) sourceHashes[path.relative(root,file).replaceAll('\\','/')]=await sourceHash(file);
for(const file of ['package-lock.json','ntsc-rs-web-wrapper/Cargo.lock','ntsc-rs-web-wrapper/build.sh','vite.crt.config.ts','scripts/generate-profiles.mjs','scripts/package-crt.mjs','scripts/patch-mediabunny.mjs','third_party/ac3/PROVENANCE.json','third_party/ac3/README.md','third_party/ac3/LICENSE','.gitmodules']) sourceHashes[file]=await sourceHash(path.join(root,file));
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({name:'@obsoletesony/crt',version:'1.0.1',upstream:'5d15ee0e48685a306109698356ccb847a54dc02c',core:'8cfc51014092a6dc1da5eb0217bb9ae6516b124e',submodules:{'valadaptive-lib':'8e6a36a0bc116d54a53703e2914d545a34dc3921','aac-codec/FFmpeg':'bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa','third_party/ac3/FFmpeg':'60a2818f76dcd1fee3155b1791304af104a0fc1b'},toolchain:{node:process.version,rust:'nightly-2026-09-05','wasm-bindgen':'0.2.129','wasm-opt':'126','cargo-about':'0.8.4'},output:{width:640,height:480,pixelAspectRatio:'1:1',video:'H.264',audio:'source AAC/MP3 passthrough or AAC reencode'},sourceHashes,artifacts},null,2)+'\n');
console.log(`Packaged ${Object.keys(artifacts).length} files with SHA-256 manifest.`);
