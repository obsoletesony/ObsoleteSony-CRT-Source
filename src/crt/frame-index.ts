import {ALL_FORMATS, BlobSource, EncodedPacketSink, Input} from 'mediabunny';

/** Presentation-order packet identity, shared by preview, seek and export, including VFR/B-frames. */
export async function indexFrames(file: Blob, signal?: AbortSignal,onProgress?:(frames:number,timestamp:number)=>void): Promise<Float64Array> {
    const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
    const abort=()=>input.dispose();signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true});
    try {
        const track=await input.getPrimaryVideoTrack();
        if(!track) throw new Error('This file has no video track.');
        const timestamps: number[]=[];
        for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})) {
            signal?.throwIfAborted();
            if(packet.timestamp+packet.duration >= 0) timestamps.push(Math.trunc(packet.timestamp*1e6));
            if(timestamps.length%500===0) onProgress?.(timestamps.length,packet.timestamp);
        }
        if(!timestamps.length) throw new Error('This file contains no video frames.');
        timestamps.sort((a,b)=>a-b);
        return Float64Array.from(new Set(timestamps));
    } finally {signal?.removeEventListener('abort',abort);input.dispose(); }
}
export function frameIndexAt(timestamps: Float64Array,timestampUs:number): number {
    let low=0, high=timestamps.length;
    while(low<high) {const mid=(low+high)>>>1; if(timestamps[mid]<timestampUs) low=mid+1; else high=mid;}
    let index=Math.min(low,timestamps.length-1);
    if(index>0 && Math.abs(timestamps[index-1]-timestampUs)<Math.abs(timestamps[index]-timestampUs)) index--;
    if(Math.abs(timestamps[index]-timestampUs)>2) throw new Error(`Decoded frame timestamp ${timestampUs} is absent from the source index.`);
    return index;
}
