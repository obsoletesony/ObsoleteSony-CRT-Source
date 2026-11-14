import defaults from '../../presets/v1/upstream-default.json' with {type: 'json'};
import descriptors from '../../presets/v1/descriptors.json' with {type: 'json'};
import registry from '../../presets/v1/registry.json' with {type: 'json'};
import catalog from '../../presets/v1/catalog.json' with {type: 'json'};

export type Settings = Readonly<Record<string, number | boolean>>;
export const UPSTREAM = '5d15ee0e48685a306109698356ccb847a54dc02c';
type Descriptor = {idName: string; kind: number; value: {defaultValue: number | boolean; min?: number; max?: number; children?: Descriptor[]; options?: {index: number}[]}};
const schema = new Map<string, Descriptor>();
function flatten(items: Descriptor[]) { for(const item of items) { schema.set(item.idName,item); if(item.value.children) flatten(item.value.children); } }
flatten(descriptors as Descriptor[]);

/** Strict front-end validation prevents the native parser silently discarding unknown keys. */
export function validatePreset(value: unknown, pin = UPSTREAM): Settings {
    if(pin !== UPSTREAM) throw new Error('Preset engine revision does not match the pinned runtime.');
    if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Preset must be a JSON object.');
    const object = value as Record<string, unknown>;
    if(object.version !== 1) throw new Error('Preset version must be 1.');
    for(const [key, value] of Object.entries(object)) {
        if(key === 'version') continue;
        const descriptor = schema.get(key);
        if(!descriptor) throw new Error(`Unknown or obsolete preset setting: ${key}`);
        const {kind, value: rule} = descriptor;
        if(typeof value !== typeof rule.defaultValue) throw new Error(`Invalid type for ${key}`);
        if(typeof value === 'number') {
            if(!Number.isFinite(value)) throw new Error(`Non-finite setting: ${key}`);
            if((kind === 0 || kind === 2) && !Number.isInteger(value)) throw new Error(`Expected integer: ${key}`);
            if(rule.options && !rule.options.some(option => option.index === value)) throw new Error(`Invalid enum: ${key}`);
            const min=rule.min ?? (kind === 1 ? 0 : -Infinity), max=rule.max ?? (kind === 1 ? 1 : Infinity);
            if(value < min || value > max) throw new Error(`Out of range: ${key} (${min}..${max})`);
        }
    }
    return Object.freeze({...defaults, ...object}) as Settings;
}
if(registry.schemaVersion !== 1 || registry.upstream !== UPSTREAM) throw new Error('Incompatible profile registry');
function select(name: string) {
    const file = (registry.profiles as Record<string,string>)[name];
    if(!file) throw new Error(`Unknown active profile: ${name}`);
    return validatePreset((catalog as Record<string,unknown>)[name], registry.upstream);
}
export const profiles = Object.freeze({stable: select(registry.activeStable), worn: select(registry.activeWorn), tracking: select(registry.activeTracking)});

function hash(value: number): number { value=Math.imul(value ^ (value>>>16),0x7feb352d); value=Math.imul(value ^ (value>>>15),0x846ca68b); return (value ^ (value>>>16))>>>0; }
export type TapeState = keyof typeof profiles;
/** Independent hashed 11-second windows; irregular offsets, gaps and durations. No mutable RNG. */
export function stateAt(timestamp: number, canonicalFrame: number, seed: number): TapeState {
    if(!Number.isFinite(timestamp) || timestamp < 0 || !Number.isInteger(canonicalFrame) || canonicalFrame < 0) throw new RangeError('Invalid frame identity');
    const bucket=Math.floor(timestamp/11), local=timestamp-bucket*11;
    const h=hash(seed ^ Math.imul(bucket+1,0x9e3779b1));
    const start=1+(hash(h ^ 17)/4294967296)*7;
    // ~14% worn; ~0.7% tracking over long recordings, with no forced first-frame damage.
    if(h % 13 === 0) {
        const length=.12+(hash(h ^ 89)/4294967296)*.48;
        if(local>=start && local<start+length) return 'tracking';
    }
    if(h % 4 !== 0) {
        const length=.7+(hash(h ^ 53)/4294967296)*2.5;
        if(local>=start && local<start+length) return 'worn';
    }
    return 'stable';
}
export function settingsAt(timestamp: number, canonicalFrame: number, seed: number, wear=true): Settings {
    return profiles[wear ? stateAt(timestamp,canonicalFrame,seed) : 'stable'];
}

/** Bounded content fingerprint; filenames and modification dates do not affect a clip's schedule. */
export async function clipSeed(file: Blob): Promise<number> {
    const parts = [new TextEncoder().encode(String(file.size))];
    for(const offset of [0,Math.max(0,Math.floor(file.size/2)-32768),Math.max(0,file.size-65536)]) parts.push(new Uint8Array(await file.slice(offset,offset+65536).arrayBuffer()));
    const data=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0)); let offset=0;
    for(const part of parts) {data.set(part,offset);offset+=part.length;}
    return new DataView(await crypto.subtle.digest('SHA-256',data)).getUint32(0,true);
}
