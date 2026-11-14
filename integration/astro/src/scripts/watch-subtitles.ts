export interface WatchCue {
  start: number;
  end: number;
  text: string;
}

function clock(value: string): number | null {
  const pieces = value.trim().replace(',', '.').split(':');
  if (pieces.length < 2 || pieces.length > 3) return null;
  const numbers = pieces.map(Number);
  if (numbers.some(n => !Number.isFinite(n) || n < 0)) return null;
  const seconds = numbers.at(-1)!;
  const minutes = numbers.at(-2)!;
  const hours = numbers.length === 3 ? numbers[0] : 0;
  if (seconds >= 60 || minutes >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Safe, text-only external SRT/VTT captions for on-screen playback. */
export function parseWatchCaptions(source: string): WatchCue[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: WatchCue[] = [];
  for (const block of normalized.split(/\n\s*\n/g)) {
    const lines = block.split('\n');
    if (/^\s*(?:NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0] ?? '')) continue;
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const [startRaw, endPart] = lines[index].split('-->');
    const start = clock(startRaw);
    const end = clock((endPart ?? '').trim().split(/\s+/)[0]);
    if (start === null || end === null || end <= start) continue;
    const text = lines.slice(index + 1).join('\n')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (!text) continue;
    cues.push({ start, end, text: text.slice(0, 800) });
    if (cues.length >= 15000) break;
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function captionAt(cues: readonly WatchCue[], time: number): string {
  let low = 0, high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].start <= time) low = middle + 1;
    else high = middle;
  }
  for (let i = low - 1; i >= 0 && i >= low - 4; i--) {
    if (cues[i].start <= time && time < cues[i].end) return cues[i].text;
  }
  return '';
}
