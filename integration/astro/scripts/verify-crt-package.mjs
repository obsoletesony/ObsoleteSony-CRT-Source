import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../public/vendor/crt/1.0.1');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
if(manifest.version!=='1.0.1'||manifest.upstream!=='5d15ee0e48685a306109698356ccb847a54dc02c')throw new Error('Unexpected CRT runtime revision');
for(const [file,expected] of Object.entries(manifest.artifacts)) {
  const resolved=path.resolve(root,file);if(!resolved.startsWith(root+path.sep))throw new Error('Invalid artifact path');
  const bytes=await fs.readFile(resolved);
  if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error(`CRT artifact mismatch: ${file}`);
}
console.log(`Verified CRT ${manifest.version}: ${Object.keys(manifest.artifacts).length} artifacts, pinned engine and golden presets.`);
