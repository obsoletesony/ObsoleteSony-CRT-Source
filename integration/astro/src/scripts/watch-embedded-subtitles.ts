import type {WatchCue} from './watch-subtitles';

export interface EmbeddedWatchTrack {
  id: number;
  language: string;
  label: string;
  codec: string;
  isDefault: boolean;
  cues: WatchCue[];
}

// Read embedded text captions from local MKV/WebM files in bounded Blob slices.
const IDS = {
  SEGMENT: 0x18538067, INFO: 0x1549a966, TRACKS: 0x1654ae6b,
  TRACK: 0xae, NUMBER: 0xd7, TYPE: 0x83, CODEC: 0x86,
  LANGUAGE: 0x22b59c, LANGUAGE_IETF: 0x22b59d, NAME: 0x536e,
  DEFAULT: 0x88, SCALE: 0x2ad7b1, CLUSTER: 0x1f43b675,
  TIMESTAMP: 0xe7, SIMPLE_BLOCK: 0xa3, BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1, DURATION: 0x9b,
};
const decoder = new TextDecoder('utf-8');
const CAP_BYTES = 65536;
const CAP_CUES = 20000;
const TEXT_CODECS = new Set(['S_TEXT/UTF8', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT']);

type EbmlElement = {id: number; start: number; end: number; size: number};

class BlobEbml {
  private windowStart = 0;
  private window = new Uint8Array(0);
  private blob: Blob;
  private signal?: AbortSignal;
  constructor(blob: Blob, signal?: AbortSignal) {this.blob = blob; this.signal = signal;}
  async bytes(pos: number, len: number): Promise<Uint8Array> {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(pos) || len < 0 || pos < 0 || pos + len > this.blob.size) throw Error('Invalid Matroska offset');
    if (len > CAP_BYTES) throw Error('Matroska subtitle payload too large');
    if (pos < this.windowStart || pos + len > this.windowStart + this.window.length) {
      this.windowStart = pos;
      this.window = new Uint8Array(await this.blob.slice(pos, Math.min(this.blob.size, pos + CAP_BYTES)).arrayBuffer());
    }
    this.signal?.throwIfAborted();
    return this.window.subarray(pos - this.windowStart, pos - this.windowStart + len);
  }
  async element(pos: number, limit: number): Promise<EbmlElement> {
    const b = await this.bytes(pos, Math.min(16, limit - pos));
    if (!b.length) throw Error('Unexpected end of Matroska');
    const idLen = leadingSize(b[0], 4);
    if (!idLen || b.length < idLen + 1) throw Error('Invalid Matroska ID');
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + b[i];
    const sizeLen = leadingSize(b[idLen], 8);
    if (!sizeLen || b.length < idLen + sizeLen) throw Error('Invalid Matroska size');
    let size = b[idLen] & (0xff >>> sizeLen);
    for (let i = 1; i < sizeLen; i++) size = size * 256 + b[idLen + i];
    const unknown = size === 2 ** (7 * sizeLen) - 1;
    const start = pos + idLen + sizeLen;
    const end = unknown ? limit : start + size;
    if (!Number.isSafeInteger(end) || end > limit || end <= pos) throw Error('Invalid Matroska bounds');
    return {id, start, end, size: unknown ? end - start : size};
  }
  async integer(el: EbmlElement): Promise<number> {
    if (el.size > 8) throw Error('Invalid Matroska integer');
    const b = await this.bytes(el.start, el.size);
    let n = 0;
    for (const byte of b) n = n * 256 + byte;
    return n;
  }
  async str(el: EbmlElement): Promise<string> {
    if (el.size > 4096) throw Error('Invalid Matroska metadata');
    return decoder.decode(await this.bytes(el.start, el.size)).replace(/\0/g, '');
  }
}

function leadingSize(byte: number, max: number) {
  for (let i = 1; i <= max; i++) if (byte & (0x80 >>> (i - 1))) return i;
  return 0;
}
async function children(reader: BlobEbml, parent: EbmlElement, cb: (child: EbmlElement) => Promise<void>) {
  let pos = parent.start;
  let count = 0;
  while (pos < parent.end) {
    if (++count > 1000000) throw Error('Too many Matroska elements');
    const el = await reader.element(pos, parent.end);
    await cb(el);
    pos = el.end;
  }
}

type InternalTrack = EmbeddedWatchTrack & {default: boolean; tickScale: number};
type RawCue = WatchCue & {explicit: boolean};

function plainText(value: string, codec: string): string {
  let text = value.replace(/^\uFEFF/, '').replace(/\0/g, '');
  if (codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA') {
    // Matroska ASS: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text.
    text = text.split(',').slice(8).join(',');
    text = text.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
  }
  return text.replace(/<[^>]*>/g, '').trim().slice(0, 2000);
}

async function readTrack(reader: BlobEbml, parent: EbmlElement): Promise<InternalTrack | null> {
  const props = {id:0,type:0,codec:'',language:'und',name:'',isDefault:true,tickScale:1};
  await children(reader, parent, async el => {
    if (el.id === IDS.NUMBER) props.id = await reader.integer(el);
    if (el.id === IDS.TYPE) props.type = await reader.integer(el);
    if (el.id === IDS.CODEC) props.codec = await reader.str(el);
    if (el.id === IDS.LANGUAGE || el.id === IDS.LANGUAGE_IETF) props.language = await reader.str(el);
    if (el.id === IDS.NAME) props.name = await reader.str(el);
    if (el.id === IDS.DEFAULT) props.isDefault = (await reader.integer(el)) !== 0;
  });
  if (props.type !== 17 || !props.id || !TEXT_CODECS.has(props.codec)) return null;
  return {
    id:props.id, codec:props.codec, language:props.language, default:props.isDefault,
    isDefault:props.isDefault, label:props.name || (props.language !== 'und' ? props.language.toUpperCase() : 'Track ' + props.id),
    tickScale:props.tickScale, cues:[],
  };
}

async function readBlock(reader: BlobEbml, el: EbmlElement, tracks: Map<number, InternalTrack>, clusterTicks: number, timestampScale: number, durationTicks?: number) {
  const header = await reader.bytes(el.start, Math.min(el.size, 16));
  if (!header.length) return;
  const n = leadingSize(header[0], 8);
  if (!n || header.length < n + 3) return;
  let trackNumber = header[0] & (0xff >>> n);
  for (let j = 1; j < n; j++) trackNumber = trackNumber * 256 + header[j];
  const track = tracks.get(trackNumber);
  if (!track || track.cues.length >= CAP_CUES) return;
  const flags = header[n+2];
  if ((flags & 0x06) !== 0) return;
  const rel = (header[n] << 8) | header[n+1];
  const relative = rel > 32767 ? rel - 65536 : rel;
  const payloadStart = el.start + n + 3;
  const length = el.end - payloadStart;
  if (length < 1 || length > CAP_BYTES) return;
  const content = plainText(decoder.decode(await reader.bytes(payloadStart, length)), track.codec);
  if (!content) return;
  const start = Math.max(0, (clusterTicks + relative * track.tickScale) * timestampScale / 1e9);
  const seconds = durationTicks === undefined ? 0 : durationTicks * timestampScale / 1e9;
  (track.cues as RawCue[]).push({start,end:seconds ? start+seconds : start,text:content,explicit:seconds>0});
}
async function readCluster(reader: BlobEbml, el: EbmlElement, tracks: Map<number, InternalTrack>, scale: number) {
  let clock = 0;
  await children(reader, el, async part => {
    if (part.id === IDS.TIMESTAMP) clock = await reader.integer(part);
    if (part.id === IDS.SIMPLE_BLOCK) await readBlock(reader,part,tracks,clock,scale);
    if (part.id === IDS.BLOCK_GROUP) {
      let block: EbmlElement | undefined;
      let duration: number | undefined;
      await children(reader, part, async child => {
        if (child.id === IDS.BLOCK) block=child;
        if (child.id === IDS.DURATION) duration=await reader.integer(child);
      });
      if (block) await readBlock(reader,block,tracks,clock,scale,duration);
    }
  });
}

/** Extract local text-based subtitle tracks without loading the entire video into memory. */
export async function readEmbeddedWatchCaptions(file: Blob, signal?: AbortSignal): Promise<EmbeddedWatchTrack[]> {
  const reader = new BlobEbml(file, signal);
  const header = await reader.bytes(0, Math.min(file.size, 4));
  if (header.length < 4 || header[0] !== 0x1a || header[1] !== 0x45 || header[2] !== 0xdf || header[3] !== 0xa3) return [];
  let position = 0;
  let segment: EbmlElement | undefined;
  while (position < file.size) {
    const el = await reader.element(position, file.size);
    if (el.id === IDS.SEGMENT) {segment=el;break;}
    position=el.end;
  }
  if (!segment) return [];
  const tracks = new Map<number, InternalTrack>();
  let scale = 1_000_000;
  await children(reader, segment, async el => {
    if (el.id === IDS.INFO) await children(reader,el,async child=>{
      if(child.id===IDS.SCALE)scale=await reader.integer(child);
    });
    if (el.id === IDS.TRACKS) await children(reader,el,async child=>{
      if(child.id===IDS.TRACK){const track=await readTrack(reader,child);if(track&&tracks.size<16)tracks.set(track.id,track);}
    });
    if (el.id === IDS.CLUSTER && tracks.size) await readCluster(reader,el,tracks,scale);
  });
  for (const track of tracks.values()) {
    const cues = track.cues as RawCue[];
    cues.sort((a,b)=>a.start-b.start);
    for(let i=0;i<cues.length;i++) {
      if (!cues[i].explicit) {
        const next = cues[i+1]?.start ?? Infinity;
        cues[i].end = Math.min(cues[i].start+5, next);
      }
      if(cues[i].end<=cues[i].start)cues[i].end=cues[i].start+.2;
    }
  }
  return [...tracks.values()].map(track => ({
    id:track.id, language:track.language, label:track.label, codec:track.codec,
    isDefault:track.default,
    cues:track.cues.map(({start,end,text}) => ({start,end,text})),
  })).filter(track=>track.cues.length>0);
}
