import {AudioBufferSink, type InputAudioTrack} from 'mediabunny';
import type {OpenOptions} from './diagnostics';

let ac3Registration:Promise<void>|undefined;
export type AudioSelection={track:InputAudioTrack|null;warnings:string[];tracks:{id:number;codec:string;decodable:boolean;error?:string}[]};
/** Try native decoders first. One selected track drives BOTH playback and export. */
export async function selectAudio(tracks:InputAudioTrack[],options:OpenOptions,selectedId?:number|null):Promise<AudioSelection> {
    const result:AudioSelection={track:null,warnings:[],tracks:[]};
    if(selectedId===null) return result;
    const candidates=selectedId===undefined?tracks:tracks.filter(track=>track.id===selectedId);
    const probe=async(track:InputAudioTrack)=>{
        options.signal?.throwIfAborted();
        const codec=String(await track.getInternalCodecId()??await track.getCodec()??'unknown');
        try {
            if(!await track.canDecode()) throw new Error('Decoder unavailable');
            const sink=new AudioBufferSink(track);
            // An actual decoded buffer catches unsupported profiles and malformed tracks too.
            const iterator=sink.buffers(Math.max(0,await track.getFirstTimestamp()));
            let first;
            try {first=await iterator.next();} finally {await iterator.return();}
            if(first.done||!first.value.buffer.length) throw new Error('No decoded audio samples');
            options.signal?.throwIfAborted();
            result.tracks.push({id:track.id,codec,decodable:true});return true;
        } catch(error) {
            options.signal?.throwIfAborted();result.tracks.push({id:track.id,codec,decodable:false,error:String(error)});return false;
        }
    };
    for(const track of candidates) if(await probe(track)){result.track=track;break;}
    if(!result.track) {
        const dolby=[];
        for(const track of candidates) if(['ac3','eac3'].includes((await track.getCodec())??'')) dolby.push(track);
        if(dolby.length) {
            try {
                ac3Registration??=import('@mediabunny/ac3').then(module=>module.registerAc3Decoder());
                await ac3Registration;options.signal?.throwIfAborted();
                for(const track of dolby) if(await probe(track)){result.track=track;break;}
            } catch(error) {options.signal?.throwIfAborted();result.warnings.push(`Local AC-3/E-AC-3 decoder unavailable: ${String(error)}`);}
        }
    }
    if(selectedId!==undefined&&!result.track) throw new Error('The selected audio track could not be decoded for export. Retry or convert locally to H.264/AAC MP4.');
    if(tracks.length&&!result.track) result.warnings.push(`Audio unavailable (${result.tracks.map(t=>t.codec).join(', ')}). Processed playback and export will be silent. For sound, convert locally to an H.264/AAC MP4 first.`);
    else if(result.track&&result.track!==tracks[0]) result.warnings.push(`Using audio track ${result.track.number}; the earlier audio track could not be decoded.`);
    return result;
}
