export interface Clip {
  id: string;
  sourcePath: string;
  sourceDuration: number;
  inPoint: number;
  outPoint: number;
}

export function clipDuration(clip: Clip): number {
  return clip.outPoint - clip.inPoint;
}

export function timelineDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipDuration(c), 0);
}

export function clipStartOnTimeline(clips: Clip[], index: number): number {
  let start = 0;
  for (let i = 0; i < index; i++) start += clipDuration(clips[i]);
  return start;
}

export interface ClipAtTime {
  clip: Clip;
  index: number;
  start: number;
  localTime: number;
}

export function findClipAtTime(clips: Clip[], time: number): ClipAtTime | null {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const dur = clipDuration(clips[i]);
    const isLast = i === clips.length - 1;
    if (time < acc + dur || isLast) {
      return { clip: clips[i], index: i, start: acc, localTime: Math.min(Math.max(time - acc, 0), dur) };
    }
    acc += dur;
  }
  return null;
}
