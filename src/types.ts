export type ClipKind = "video" | "image";

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number; // 0..1
}

export interface Clip {
  id: string;
  kind: ClipKind;
  sourcePath: string;
  sourceDuration: number;
  inPoint: number;
  outPoint: number;
  transform: Transform;
}

export interface Track {
  id: string;
  name: string;
  clips: Clip[];
}

export const PROJECT_WIDTH = 1920;
export const PROJECT_HEIGHT = 1080;

export const DEFAULT_IMAGE_DURATION = 5;
export const IMAGE_MAX_DURATION = 24 * 3600;

export function fullFrameTransform(): Transform {
  return { x: 0, y: 0, width: PROJECT_WIDTH, height: PROJECT_HEIGHT, opacity: 1 };
}

// The bottom-most track defaults to filling the frame; any track above it defaults
// to a smaller picture-in-picture box so it doesn't fully hide the layers below it.
export function defaultTransformForTrackIndex(trackIndex: number): Transform {
  if (trackIndex <= 0) return fullFrameTransform();
  const width = Math.round(PROJECT_WIDTH * 0.35);
  const height = Math.round(PROJECT_HEIGHT * 0.35);
  const margin = Math.round(PROJECT_WIDTH * 0.02);
  return { x: PROJECT_WIDTH - width - margin, y: margin, width, height, opacity: 1 };
}

export function clipDuration(clip: Clip): number {
  return clip.outPoint - clip.inPoint;
}

export function timelineDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipDuration(c), 0);
}

export function totalDuration(tracks: Track[]): number {
  return tracks.reduce((max, t) => Math.max(max, timelineDuration(t.clips)), 0);
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

export function activeClipAt(clips: Clip[], time: number): ClipAtTime | null {
  const duration = timelineDuration(clips);
  if (time > duration) return null;
  return findClipAtTime(clips, time);
}

export function findClipTrack(tracks: Track[], clipId: string): Track | null {
  return tracks.find((t) => t.clips.some((c) => c.id === clipId)) ?? null;
}
