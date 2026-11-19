import { useReducer } from "react";
import {
  type Asset,
  type ProjectSettings,
  type Segment,
  type Track,
  type Transform,
  type TransformKeyframe,
  findFreeStart,
  fullFrameTransform,
  segmentDuration,
  segmentEnd,
} from "./types";

export interface EditorState {
  project: ProjectSettings | null;
  assets: Asset[];
  tracks: Track[];
  selectedTrackId: string | null;
  selectedSegmentId: string | null;
  selectedKeyframeId: string | null;
  playhead: number;
  seekVersion: number;
}

type Action =
  | { type: "CREATE_PROJECT"; width: number; height: number }
  | { type: "ADD_ASSET"; asset: Asset }
  | { type: "ADD_TRACK" }
  | { type: "MOVE_TRACK_UP"; id: string }
  | { type: "MOVE_TRACK_DOWN"; id: string }
  | { type: "DELETE_TRACK"; id: string }
  | { type: "SELECT_TRACK"; id: string | null }
  | { type: "ADD_SEGMENT"; trackId: string; segment: Segment }
  | { type: "MOVE_SEGMENT"; id: string; trackId: string; start: number }
  | { type: "SELECT_SEGMENT"; id: string | null }
  | { type: "DELETE_SEGMENT"; id: string }
  | { type: "SPLIT_SEGMENT"; id: string; atLocalTime: number }
  | { type: "SPLIT_AUDIO"; id: string }
  | { type: "TRIM_SEGMENT"; id: string; inPoint?: number; outPoint?: number }
  | { type: "SET_TRANSFORM"; id: string; patch: Partial<Transform> }
  | { type: "SET_ASPECT_LOCK"; id: string; locked: boolean }
  | { type: "SET_SCALE_AXIS"; id: string; axis: "width" | "height"; checked: boolean }
  | { type: "SET_VOLUME"; id: string; volume: number }
  | { type: "ADD_KEYFRAME"; id: string; time: number; data: Omit<TransformKeyframe, "id" | "time"> }
  | { type: "SELECT_KEYFRAME"; id: string | null }
  | { type: "UPDATE_KEYFRAME"; id: string; keyframeId: string; patch: Partial<Omit<TransformKeyframe, "id">> }
  | { type: "DELETE_KEYFRAME"; id: string; keyframeId: string }
  | { type: "SET_PLAYHEAD"; time: number; fromPlayback?: boolean };

const MIN_SEGMENT_LENGTH = 0.1;

function makeTrack(name: string): Track {
  return { id: crypto.randomUUID(), name, segments: [] };
}

const initialTrack = makeTrack("Camada 1");

const initialState: EditorState = {
  project: null,
  assets: [],
  tracks: [initialTrack],
  selectedTrackId: initialTrack.id,
  selectedSegmentId: null,
  selectedKeyframeId: null,
  playhead: 0,
  seekVersion: 0,
};

function mapTrackSegments(tracks: Track[], trackId: string, fn: (segments: Segment[]) => Segment[]): Track[] {
  return tracks.map((t) => (t.id === trackId ? { ...t, segments: fn(t.segments) } : t));
}

function findTrackIndexBySegment(tracks: Track[], segmentId: string): { trackIndex: number; segmentIndex: number } | null {
  for (let i = 0; i < tracks.length; i++) {
    const segmentIndex = tracks[i].segments.findIndex((s) => s.id === segmentId);
    if (segmentIndex !== -1) return { trackIndex: i, segmentIndex };
  }
  return null;
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "CREATE_PROJECT":
      return { ...state, project: { width: action.width, height: action.height } };

    case "ADD_ASSET":
      return { ...state, assets: [...state.assets, action.asset] };

    case "ADD_TRACK": {
      const track = makeTrack(`Camada ${state.tracks.length + 1}`);
      return { ...state, tracks: [...state.tracks, track], selectedTrackId: track.id };
    }

    case "MOVE_TRACK_UP": {
      const index = state.tracks.findIndex((t) => t.id === action.id);
      if (index <= 0) return state;
      const tracks = [...state.tracks];
      [tracks[index - 1], tracks[index]] = [tracks[index], tracks[index - 1]];
      return { ...state, tracks };
    }

    case "MOVE_TRACK_DOWN": {
      const index = state.tracks.findIndex((t) => t.id === action.id);
      if (index === -1 || index >= state.tracks.length - 1) return state;
      const tracks = [...state.tracks];
      [tracks[index + 1], tracks[index]] = [tracks[index], tracks[index + 1]];
      return { ...state, tracks };
    }

    case "DELETE_TRACK": {
      if (state.tracks.length <= 1) return state;
      const tracks = state.tracks.filter((t) => t.id !== action.id);
      const removedSegmentIds = new Set(
        state.tracks.find((t) => t.id === action.id)?.segments.map((s) => s.id) ?? [],
      );
      return {
        ...state,
        tracks,
        selectedTrackId: state.selectedTrackId === action.id ? (tracks[0]?.id ?? null) : state.selectedTrackId,
        selectedSegmentId:
          state.selectedSegmentId && removedSegmentIds.has(state.selectedSegmentId) ? null : state.selectedSegmentId,
      };
    }

    case "SELECT_TRACK":
      return { ...state, selectedTrackId: action.id };

    case "ADD_SEGMENT": {
      const tracks = state.tracks.map((t) => {
        if (t.id !== action.trackId) return t;
        const duration = segmentDuration(action.segment);
        const start = findFreeStart(t.segments, action.segment.start, duration);
        return { ...t, segments: [...t.segments, { ...action.segment, start }] };
      });
      return {
        ...state,
        tracks,
        selectedTrackId: action.trackId,
        selectedSegmentId: action.segment.id,
        selectedKeyframeId: null,
        seekVersion: state.seekVersion + 1,
      };
    }

    case "MOVE_SEGMENT": {
      const location = findTrackIndexBySegment(state.tracks, action.id);
      if (!location) return state;
      const sourceTrack = state.tracks[location.trackIndex];
      const segment = sourceTrack.segments[location.segmentIndex];
      const duration = segmentDuration(segment);

      let tracks = state.tracks.map((t) =>
        t.id === sourceTrack.id ? { ...t, segments: t.segments.filter((s) => s.id !== action.id) } : t,
      );
      tracks = tracks.map((t) => {
        if (t.id !== action.trackId) return t;
        const start = findFreeStart(t.segments, action.start, duration);
        return { ...t, segments: [...t.segments, { ...segment, start }] };
      });
      return { ...state, tracks, selectedTrackId: action.trackId, selectedSegmentId: action.id };
    }

    case "SELECT_SEGMENT":
      return { ...state, selectedSegmentId: action.id, selectedKeyframeId: null };

    case "DELETE_SEGMENT": {
      const tracks = state.tracks.map((t) => ({ ...t, segments: t.segments.filter((s) => s.id !== action.id) }));
      return {
        ...state,
        tracks,
        selectedSegmentId: state.selectedSegmentId === action.id ? null : state.selectedSegmentId,
        selectedKeyframeId: state.selectedSegmentId === action.id ? null : state.selectedKeyframeId,
      };
    }

    case "SPLIT_SEGMENT": {
      const location = findTrackIndexBySegment(state.tracks, action.id);
      if (!location) return state;
      const track = state.tracks[location.trackIndex];
      const segment = track.segments[location.segmentIndex];
      const splitAt = segment.inPoint + action.atLocalTime;
      if (splitAt <= segment.inPoint + MIN_SEGMENT_LENGTH || splitAt >= segment.outPoint - MIN_SEGMENT_LENGTH) {
        return state;
      }
      const left: Segment = { ...segment, outPoint: splitAt };
      const right: Segment = {
        ...segment,
        id: crypto.randomUUID(),
        inPoint: splitAt,
        start: segment.start + action.atLocalTime,
        keyframes: segment.keyframes.map((k) => ({ ...k, time: k.time - action.atLocalTime })),
      };
      const tracks = mapTrackSegments(state.tracks, track.id, (segments) => {
        const next = [...segments];
        next.splice(location.segmentIndex, 1, left, right);
        return next;
      });
      return { ...state, tracks, selectedSegmentId: left.id };
    }

    case "SPLIT_AUDIO": {
      const location = findTrackIndexBySegment(state.tracks, action.id);
      if (!location) return state;
      const sourceTrack = state.tracks[location.trackIndex];
      const original = sourceTrack.segments[location.segmentIndex];
      if (original.kind !== "video") return state;

      const projectWidth = state.project?.width ?? 1920;
      const projectHeight = state.project?.height ?? 1080;

      // The new audio segment inherits the original's volume keyframes (so any
      // volume animation moves with the sound); the leftover video is silenced
      // by zeroing volume everywhere, base and keyframes alike.
      const audioKeyframes = original.keyframes.map((k) => ({ ...k, id: crypto.randomUUID() }));
      const mutedKeyframes = original.keyframes.map((k) => ({ ...k, volume: 0 }));

      const audioSegment: Segment = {
        id: crypto.randomUUID(),
        assetId: original.assetId,
        kind: "audio",
        start: original.start,
        inPoint: original.inPoint,
        outPoint: original.outPoint,
        transform: fullFrameTransform(projectWidth, projectHeight),
        sizeMode: { lockAspectRatio: false, scaleAxes: { width: true, height: false } },
        keyframes: audioKeyframes,
        volume: original.volume,
      };

      const newTrack: Track = { ...makeTrack(`Camada ${state.tracks.length + 1}`), segments: [audioSegment] };

      const tracks = [
        ...state.tracks.map((t) =>
          t.id === sourceTrack.id
            ? { ...t, segments: t.segments.map((s) => (s.id === action.id ? { ...s, volume: 0, keyframes: mutedKeyframes } : s)) }
            : t,
        ),
        newTrack,
      ];

      return { ...state, tracks };
    }

    case "TRIM_SEGMENT": {
      const tracks = state.tracks.map((t) => {
        const original = t.segments.find((s) => s.id === action.id);
        if (!original) return t;
        const asset = state.assets.find((a) => a.id === original.assetId);
        const maxOut = asset?.duration ?? original.outPoint;

        let inPoint = action.inPoint ?? original.inPoint;
        let outPoint = action.outPoint ?? original.outPoint;
        inPoint = Math.max(0, Math.min(inPoint, outPoint - MIN_SEGMENT_LENGTH));
        outPoint = Math.min(maxOut, Math.max(outPoint, inPoint + MIN_SEGMENT_LENGTH));
        let start = original.start + (inPoint - original.inPoint);

        const others = t.segments.filter((s) => s.id !== action.id);
        const prevEnd = Math.max(0, ...others.filter((o) => segmentEnd(o) <= original.start + 1e-6).map(segmentEnd));
        const nextStarts = others.filter((o) => o.start >= segmentEnd(original) - 1e-6).map((o) => o.start);
        const nextStart = nextStarts.length > 0 ? Math.min(...nextStarts) : Infinity;

        start = Math.max(start, prevEnd);
        let duration = outPoint - inPoint;
        if (start + duration > nextStart) {
          duration = Math.max(MIN_SEGMENT_LENGTH, nextStart - start);
          outPoint = inPoint + duration;
        }

        return {
          ...t,
          segments: t.segments.map((s) => (s.id === action.id ? { ...s, inPoint, outPoint, start } : s)),
        };
      });
      return { ...state, tracks };
    }

    case "SET_TRANSFORM": {
      // Aspect-ratio linking is applied by the caller (it must also apply when the
      // edit lands on a keyframe instead of the base transform), so this just merges.
      const tracks = state.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) => (s.id === action.id ? { ...s, transform: { ...s.transform, ...action.patch } } : s)),
      }));
      return { ...state, tracks };
    }

    case "SET_ASPECT_LOCK": {
      const tracks = state.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) => {
          if (s.id !== action.id) return s;
          let scaleAxes = s.sizeMode.scaleAxes;
          // Locking while both axes are pinned would mean "stretch and keep ratio"
          // at once; drop back to width-only, matching the checkbox default.
          if (action.locked && scaleAxes.width && scaleAxes.height) {
            scaleAxes = { width: true, height: false };
          }
          return { ...s, sizeMode: { ...s.sizeMode, lockAspectRatio: action.locked, scaleAxes } };
        }),
      }));
      return { ...state, tracks };
    }

    case "SET_SCALE_AXIS": {
      const tracks = state.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) => {
          if (s.id !== action.id) return s;
          const next = { ...s.sizeMode.scaleAxes, [action.axis]: action.checked };
          // Never allow both axes to end up unchecked.
          if (!next.width && !next.height) return s;
          // While locked, checking one axis clears the other (radio behavior).
          if (s.sizeMode.lockAspectRatio && action.checked) {
            if (action.axis === "width") next.height = false;
            else next.width = false;
          }
          return { ...s, sizeMode: { ...s.sizeMode, scaleAxes: next } };
        }),
      }));
      return { ...state, tracks };
    }

    case "SET_VOLUME": {
      const volume = Math.min(1, Math.max(0, action.volume));
      const tracks = state.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) => (s.id === action.id ? { ...s, volume } : s)),
      }));
      return { ...state, tracks };
    }

    case "ADD_KEYFRAME": {
      const keyframe: TransformKeyframe = { id: crypto.randomUUID(), time: action.time, ...action.data };
      const tracks = state.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) => (s.id === action.id ? { ...s, keyframes: [...s.keyframes, keyframe] } : s)),
      }));
      return { ...state, tracks, selectedKeyframeId: keyframe.id };
    }

    case "SELECT_KEYFRAME":
      return { ...state, selectedKeyframeId: action.id };

    case "UPDATE_KEYFRAME": {
      const tracks = state.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) =>
          s.id === action.id
            ? { ...s, keyframes: s.keyframes.map((k) => (k.id === action.keyframeId ? { ...k, ...action.patch } : k)) }
            : s,
        ),
      }));
      return { ...state, tracks };
    }

    case "DELETE_KEYFRAME": {
      const tracks = state.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) =>
          s.id === action.id ? { ...s, keyframes: s.keyframes.filter((k) => k.id !== action.keyframeId) } : s,
        ),
      }));
      return {
        ...state,
        tracks,
        selectedKeyframeId: state.selectedKeyframeId === action.keyframeId ? null : state.selectedKeyframeId,
      };
    }

    case "SET_PLAYHEAD":
      return {
        ...state,
        playhead: Math.max(0, action.time),
        seekVersion: action.fromPlayback ? state.seekVersion : state.seekVersion + 1,
      };

    default:
      return state;
  }
}

export function useEditorState() {
  return useReducer(reducer, initialState);
}
