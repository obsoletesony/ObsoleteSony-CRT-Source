import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import SETTING_DESCRIPTORS from '../ntsc-rs-web-wrapper/build/setting-descriptors.ts';
const directory = new URL('../presets/v1/', import.meta.url);
await fs.mkdir(directory, {recursive: true});
const defaults = {version: 1};
function collect(items) { for (const item of items) { defaults[item.idName] = item.value.defaultValue; if(item.value.children) collect(item.value.children); } }
collect(SETTING_DESCRIPTORS);
const text = JSON.stringify(defaults, null, 2)+'\n';
await fs.writeFile(new URL('upstream-default.json', directory), text);
await fs.writeFile(new URL('descriptors.json', directory), JSON.stringify(SETTING_DESCRIPTORS,null,2)+'\n');
await fs.writeFile(new URL('provenance.json', directory), JSON.stringify({version:1,upstream:'5d15ee0e48685a306109698356ccb847a54dc02c',core:'8cfc51014092a6dc1da5eb0217bb9ae6516b124e',sha256:createHash('sha256').update(text).digest('hex'),generator:'scripts/generate-profiles.mjs',source:'ntsc-rs-web-wrapper/build/setting-descriptors.ts',removed:['video_scanline_phase_shift','video_scanline_phase_shift_offset'],changed:{vhs_chroma_vert_blend:{committed:true,generated:false}}},null,2)+'\n');
console.log(`Generated ${Object.keys(defaults).length-1} settings from the executable descriptor baseline.`);
const registry = JSON.parse(await fs.readFile(new URL('registry.json',directory),'utf8'));
const catalog = {};
for(const [name,file] of Object.entries(registry.profiles)) {
    if(!/^[a-z0-9-]+\.json$/.test(file)) throw new Error('Profile filenames must be local JSON files');
    catalog[name]=JSON.parse(await fs.readFile(new URL(file,directory),'utf8'));
}
await fs.writeFile(new URL('catalog.json',directory),JSON.stringify(catalog,null,2)+'\n');
