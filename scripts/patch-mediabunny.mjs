/** Scoped MPL-2.0 Matroska CodecDelay correction against the locked Mediabunny 1.55.7.
 * RFC 9559 CodecDelay is nanoseconds subtracted from every decoded timestamp.
 * Seek queries must apply the inverse offset before consulting raw cluster/cue timestamps.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),base=path.join(root,'node_modules/mediabunny');
const pkg=JSON.parse(await fs.readFile(path.join(base,'package.json'),'utf8'));
if(pkg.version!=='1.55.7')throw new Error('Review the CodecDelay patch before changing Mediabunny 1.55.7.');
for(const relative of ['src/matroska/matroska-demuxer.ts','dist/modules/src/matroska/matroska-demuxer.js']) {
 let text=(await fs.readFile(path.join(base,relative),'utf8')).replaceAll('\r\n','\n');
 if(text.includes('ObsoleteSony: honor Matroska CodecDelay'))continue;
 function replace(before,after){if(text.split(before).length!==2)throw new Error(`Unexpected patch context: ${relative}: ${before}`);text=text.replace(before,after);}
 if(relative.endsWith('.ts')) replace('codecId: string | null;','codecId: string | null;\n\tcodecDelayNs: number;');
 replace('codecId: null,','codecId: null,\n                    codecDelayNs: 0,');
 replace('case EBMLId.CodecID:',`// ObsoleteSony: honor Matroska CodecDelay (RFC 9559), 2026-11-14.
            case EBMLId.CodecDelay: {
                if (this.currentTrack) this.currentTrack.codecDelayNs = readUnsignedInt(slice, size);
            } break;
            case EBMLId.CodecID:`);
 replace('timestamp * this.internalTrack.segment.timestampFactor','(timestamp + this.internalTrack.codecDelayNs / 1e9) * this.internalTrack.segment.timestampFactor');
 replace('const timestamp = block.timestamp / this.internalTrack.segment.timestampFactor;', 'const timestamp = block.timestamp / this.internalTrack.segment.timestampFactor - this.internalTrack.codecDelayNs / 1e9;');
 // The shipped dependency map describes the unmodified code; let Vite map this patched module itself.
 if(relative.endsWith('.js'))text=text.replace(/\/\/# sourceMappingURL=.*$/m,'');
 await fs.writeFile(path.join(base,relative),text);
}
// Preserve negative audio preroll in regular MP4 using an edit list. Other formats,
// video timestamps and fragmented output retain the upstream nonnegative constraint.
for(const module of ['muxer','isobmff/isobmff-muxer','isobmff/isobmff-boxes']) {
 for(const extension of ['ts','js']) {
  const relative=extension==='ts'?`src/${module}.ts`:`dist/modules/src/${module}.js`;
  let source=(await fs.readFile(path.join(base,relative),'utf8')).replaceAll('\r\n','\n');
  if(source.includes('ObsoleteSony: preserve MP4 audio preroll'))continue;
  function replace(before,after){if(source.split(before).length!==2)throw new Error(`Unexpected preroll patch context: ${relative}: ${before}`);source=source.replace(before,after);}
  if(module==='muxer') {
   replace(extension==='ts'?'isKeyPacket: boolean) {':'validateTimestamp(track, timestampInSeconds, isKeyPacket) {',extension==='ts'?'isKeyPacket: boolean, allowNegative = false) {':'validateTimestamp(track, timestampInSeconds, isKeyPacket, allowNegative = false) {');
   replace('if (timestampInSeconds < 0) {','if (timestampInSeconds < 0 && !allowNegative) {');
  } else if(module.endsWith('-muxer')) {
   const position=source.indexOf('async addEncodedAudioPacket('),prefix=source.slice(0,position);source=source.slice(position);
   const validation=extension==='ts'?"packet.type === 'key',\n\t\t\t);":"this.validateTimestamp(trackData.track, packet.timestamp, packet.type === 'key');";
   replace(validation,extension==='ts'?"packet.type === 'key',\n                !this.isFragmented,\n\t\t\t);":"this.validateTimestamp(trackData.track, packet.timestamp, packet.type === 'key', !this.isFragmented);");
   source=prefix+source;
  } else {
   replace('trackData.startTimestampOffset > 0','trackData.startTimestampOffset !== 0');
   replace('const startOffset = intoTimescale(offset, GLOBAL_TIMESCALE);',`if (offset < 0) {
        // One edit skips preroll in media time, while retaining every encoded packet.
        const duration = Math.max(0, intoTimescale(presentationSpan(trackData) + offset, GLOBAL_TIMESCALE));
        return box('edts', undefined, [fullBox('elst', 1, 0, [
            u32(1), u64(duration), i64(intoTimescale(-offset, trackData.timescale)), fixed_16_16(1),
        ])]);
    }
    const startOffset = intoTimescale(offset, GLOBAL_TIMESCALE);`);
  }
  source='// ObsoleteSony: preserve MP4 audio preroll, 2026-11-14.\n'+source.replace(/\/\/# sourceMappingURL=.*$/m,'');
  await fs.writeFile(path.join(base,relative),source);
 }
}
console.log('Applied/rechecked Mediabunny 1.55.7 CodecDelay and MP4 preroll corrections.');
