export type AssetKind = "video" | "image" | "audio";

// A file the user imported. Lives in the project's library independently of
// whatever segments on the timeline reference it (an asset can back zero, one,
// or many segments).
export interface Asset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  name: string;
  duration: number;
  width?: number;
  height?: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
}

export const RESOLUTION_PRESETS: { label: string; width: number; height: number }[] = [
  { label: "1920x1080 (16:9)", width: 1920, height: 1080 },
  { label: "1080x1920 (9:16, vertical)", width: 1080, height: 1920 },
  { label: "1280x720 (HD)", width: 1280, height: 720 },
  { label: "3840x2160 (4K)", width: 3840, height: 2160 },
  { label: "1080x1080 (quadrado)", width: 1080, height: 1080 },
];

export const DEFAULT_IMAGE_DURATION = 5;
export const IMAGE_MAX_DURATION = 24 * 3600;

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number; // 0..1
  rotation: number; // degrees, clockwise
}

// A waypoint for the segment's full transform plus volume. `time` is local to
// the segment (0 = segment start), independent of where the segment sits on
// the track's timeline. Every field is captured so selecting a keyframe can
// edit position, size, rotation, opacity and volume all at that instant.
export interface TransformKeyframe {
  id: string;
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  volume: number;
}

// Controls how width/height are edited for a visual segment. `lockAspectRatio`
// makes editing one numeric field recompute the other from the asset's natural
// ratio. `scaleAxes` is which axis (or both) the "scale to canvas" button pins to
// the project's size; at least one is always on, and while locked at most one can
// be (checking one clears the other).
export interface SizeMode {
  lockAspectRatio: boolean;
  scaleAxes: { width: boolean; height: boolean };
}

// One item placed on a track's timeline, referencing an asset by id.
export interface Segment {
  id: string;
  assetId: string;
  kind: AssetKind;
  start: number; // absolute position on the track, seconds
  inPoint: number; // trim within the asset's own source
  outPoint: number;
  transform: Transform; // meaningful for video/image
  sizeMode: SizeMode; // meaningful for video/image
  keyframes: TransformKeyframe[];
  volume: number; // 0..1, meaningful for video/audio
}

export interface Track {
  id: string;
  name: string;
  segments: Segment[];
}

export function fullFrameTransform(projectWidth: number, projectHeight: number): Transform {
  return { x: 0, y: 0, width: projectWidth, height: projectHeight, opacity: 1, rotation: 0 };
}

// The bottom-most track's default box is the whole canvas; any track above it
// defaults to a smaller picture-in-picture box so it doesn't fully hide the layers
// below it.
function defaultBoxForTrackIndex(trackIndex: number, projectWidth: number, projectHeight: number) {
  if (trackIndex <= 0) return { x: 0, y: 0, width: projectWidth, height: projectHeight };
  const width = Math.round(projectWidth * 0.35);
  const height = Math.round(projectHeight * 0.35);
  const margin = Math.round(projectWidth * 0.02);
  return { x: projectWidth - width - margin, y: margin, width, height };
}

// Computes the default transform + size mode for a newly placed segment. When the
// asset's natural size is known, the segment is scaled down/up to fit entirely
// inside its default box (preserving aspect ratio, centered) instead of being
// stretched to exactly fill it.
export function defaultSizingForAsset(
  trackIndex: number,
  projectWidth: number,
  projectHeight: number,
  naturalSize?: { width: number; height: number },
): { transform: Transform; sizeMode: SizeMode } {
  const box = defaultBoxForTrackIndex(trackIndex, projectWidth, projectHeight);

  if (!naturalSize || naturalSize.width <= 0 || naturalSize.height <= 0) {
    return {
      transform: { x: box.x, y: box.y, width: box.width, height: box.height, opacity: 1, rotation: 0 },
      sizeMode: { lockAspectRatio: false, scaleAxes: { width: true, height: false } },
    };
  }

  const scale = Math.min(box.width / naturalSize.width, box.height / naturalSize.height);
  const width = Math.round(naturalSize.width * scale);
  const height = Math.round(naturalSize.height * scale);
  const x = Math.round(box.x + (box.width - width) / 2);
  const y = Math.round(box.y + (box.height - height) / 2);

  return {
    transform: { x, y, width, height, opacity: 1, rotation: 0 },
    sizeMode: { lockAspectRatio: true, scaleAxes: { width: true, height: false } },
  };
}

export function segmentDuration(segment: Segment): number {
  return segment.outPoint - segment.inPoint;
}

export function segmentEnd(segment: Segment): number {
  return segment.start + segmentDuration(segment);
}

export function segmentLocalTime(segment: Segment, globalTime: number): number {
  return Math.min(Math.max(globalTime - segment.start, 0), segmentDuration(segment));
}

export function trackDuration(track: Track): number {
  return track.segments.reduce((max, s) => Math.max(max, segmentEnd(s)), 0);
}

export function totalDuration(tracks: Track[]): number {
  return tracks.reduce((max, t) => Math.max(max, trackDuration(t)), 0);
}

export function findSegmentAtTime(segments: Segment[], time: number): Segment | null {
  return segments.find((s) => time >= s.start && time < segmentEnd(s)) ?? null;
}

export interface SegmentAtTime {
  segment: Segment;
  localTime: number;
}

export function activeSegmentAt(segments: Segment[], time: number): SegmentAtTime | null {
  const segment = findSegmentAtTime(segments, time);
  if (!segment) return null;
  return { segment, localTime: segmentLocalTime(segment, time) };
}

export function segmentsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Pushes `desiredStart` forward until the [start, start+duration) window no longer
// overlaps any other segment already on the track (used for drag-and-drop placement
// and for moving/resizing an existing segment).
export function findFreeStart(segments: Segment[], desiredStart: number, duration: number, excludeId?: string): number {
  const others = segments.filter((s) => s.id !== excludeId).sort((a, b) => a.start - b.start);
  let start = Math.max(0, desiredStart);
  let moved = true;
  while (moved) {
    moved = false;
    for (const s of others) {
      const sEnd = segmentEnd(s);
      if (segmentsOverlap(start, start + duration, s.start, sEnd)) {
        start = sEnd;
        moved = true;
      }
    }
  }
  return start;
}

export function findSegmentTrack(tracks: Track[], segmentId: string): Track | null {
  return tracks.find((t) => t.segments.some((s) => s.id === segmentId)) ?? null;
}

function keyframeTransform(k: TransformKeyframe): Transform {
  return { x: k.x, y: k.y, width: k.width, height: k.height, opacity: k.opacity, rotation: k.rotation };
}

// Resolves the segment's effective transform at a given local time (0 = segment
// start), linearly interpolating every field between the surrounding keyframes.
// With no keyframes, falls back to the segment's static transform.
export function resolveTransform(segment: Segment, localTime: number): Transform {
  const keyframes = segment.keyframes;
  if (!keyframes || keyframes.length === 0) return segment.transform;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (localTime <= sorted[0].time) return keyframeTransform(sorted[0]);
  const last = sorted[sorted.length - 1];
  if (localTime >= last.time) return keyframeTransform(last);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (localTime >= a.time && localTime <= b.time) {
      const span = Math.max(b.time - a.time, 1e-6);
      const t = (localTime - a.time) / span;
      const lerp = (p: number, q: number) => p + (q - p) * t;
      return {
        x: lerp(a.x, b.x),
        y: lerp(a.y, b.y),
        width: lerp(a.width, b.width),
        height: lerp(a.height, b.height),
        opacity: lerp(a.opacity, b.opacity),
        rotation: lerp(a.rotation, b.rotation),
      };
    }
  }
  return keyframeTransform(last);
}

// Resolves the segment's effective volume at a given local time, the same way
// resolveTransform does for the visual transform: linearly interpolated
// between the surrounding keyframes, or the segment's static volume with none.
export function resolveVolume(segment: Segment, localTime: number): number {
  const keyframes = segment.keyframes;
  if (!keyframes || keyframes.length === 0) return segment.volume;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (localTime <= sorted[0].time) return sorted[0].volume;
  const last = sorted[sorted.length - 1];
  if (localTime >= last.time) return last.volume;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (localTime >= a.time && localTime <= b.time) {
      const span = Math.max(b.time - a.time, 1e-6);
      const t = (localTime - a.time) / span;
      return a.volume + (b.volume - a.volume) * t;
    }
  }
  return last.volume;
}
