import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const site=path.resolve(process.argv[2] ?? '../website');
await fs.access(path.join(site,'src/pages/watch.astro'));
const source=path.resolve(import.meta.dirname,'../package/crt-1.0.1');
const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
for(const [file,info] of Object.entries(manifest.artifacts)) {
    const hash=createHash('sha256').update(await fs.readFile(path.join(source,file))).digest('hex');
    if(hash!==info.sha256) throw new Error(`Corrupt runtime artifact: ${file}`);
}
const dest=path.join(site,'public/vendor/crt/1.0.1');
try {
    const old=JSON.parse(await fs.readFile(path.join(dest,'manifest.json'),'utf8'));
    for(const [file,info] of Object.entries(old.artifacts)) if(!manifest.artifacts[file]) {
        const target=path.resolve(dest,file);
        if(!target.startsWith(dest+path.sep)) throw new Error('Artifact path escapes package directory');
        const data=await fs.readFile(target);
        if(createHash('sha256').update(data).digest('hex')!==info.sha256) throw new Error(`Refusing to remove locally edited artifact: ${file}`);
        await fs.unlink(target);
    }
} catch(error) {if(error.code!=='ENOENT') throw error;}
await fs.mkdir(dest,{recursive:true});await fs.cp(source,dest,{recursive:true});
console.log(`Installed verified CRT ${manifest.version} into ${dest}`);
