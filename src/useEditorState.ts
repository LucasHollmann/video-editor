import { useReducer } from "react";
import { type Clip, type Track, type Transform, totalDuration } from "./types";

export interface EditorState {
  tracks: Track[];
  selectedTrackId: string | null;
  selectedClipId: string | null;
  playhead: number;
  seekVersion: number;
}

type Action =
  | { type: "ADD_TRACK" }
  | { type: "MOVE_TRACK_UP"; id: string }
  | { type: "MOVE_TRACK_DOWN"; id: string }
  | { type: "DELETE_TRACK"; id: string }
  | { type: "SELECT_TRACK"; id: string | null }
  | { type: "ADD_CLIP"; trackId: string; clip: Clip }
  | { type: "SELECT_CLIP"; id: string | null }
  | { type: "DELETE_CLIP"; id: string }
  | { type: "SPLIT_CLIP"; id: string; atLocalTime: number }
  | { type: "TRIM_CLIP"; id: string; inPoint?: number; outPoint?: number }
  | { type: "SET_TRANSFORM"; id: string; patch: Partial<Transform> }
  | { type: "SET_PLAYHEAD"; time: number; fromPlayback?: boolean };

const MIN_CLIP_LENGTH = 0.1;

function makeTrack(name: string): Track {
  return { id: crypto.randomUUID(), name, clips: [] };
}

const initialTrack = makeTrack("Camada 1");

const initialState: EditorState = {
  tracks: [initialTrack],
  selectedTrackId: initialTrack.id,
  selectedClipId: null,
  playhead: 0,
  seekVersion: 0,
};

function mapTrackClips(tracks: Track[], trackId: string, fn: (clips: Clip[]) => Clip[]): Track[] {
  return tracks.map((t) => (t.id === trackId ? { ...t, clips: fn(t.clips) } : t));
}

function findTrackIndexByClip(tracks: Track[], clipId: string): { trackIndex: number; clipIndex: number } | null {
  for (let i = 0; i < tracks.length; i++) {
    const clipIndex = tracks[i].clips.findIndex((c) => c.id === clipId);
    if (clipIndex !== -1) return { trackIndex: i, clipIndex };
  }
  return null;
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
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
      const removedClipIds = new Set(
        state.tracks.find((t) => t.id === action.id)?.clips.map((c) => c.id) ?? [],
      );
      return {
        ...state,
        tracks,
        selectedTrackId: state.selectedTrackId === action.id ? (tracks[0]?.id ?? null) : state.selectedTrackId,
        selectedClipId: state.selectedClipId && removedClipIds.has(state.selectedClipId) ? null : state.selectedClipId,
      };
    }

    case "SELECT_TRACK":
      return { ...state, selectedTrackId: action.id };

    case "ADD_CLIP": {
      const tracks = mapTrackClips(state.tracks, action.trackId, (clips) => [...clips, action.clip]);
      return {
        ...state,
        tracks,
        selectedTrackId: action.trackId,
        selectedClipId: action.clip.id,
        playhead: totalDuration(tracks),
        seekVersion: state.seekVersion + 1,
      };
    }

    case "SELECT_CLIP":
      return { ...state, selectedClipId: action.id };

    case "DELETE_CLIP": {
      const tracks = state.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== action.id) }));
      return {
        ...state,
        tracks,
        selectedClipId: state.selectedClipId === action.id ? null : state.selectedClipId,
      };
    }

    case "SPLIT_CLIP": {
      const location = findTrackIndexByClip(state.tracks, action.id);
      if (!location) return state;
      const track = state.tracks[location.trackIndex];
      const clip = track.clips[location.clipIndex];
      const splitAt = clip.inPoint + action.atLocalTime;
      if (splitAt <= clip.inPoint + MIN_CLIP_LENGTH || splitAt >= clip.outPoint - MIN_CLIP_LENGTH) {
        return state;
      }
      const left: Clip = { ...clip, outPoint: splitAt };
      const right: Clip = { ...clip, id: crypto.randomUUID(), inPoint: splitAt };
      const tracks = mapTrackClips(state.tracks, track.id, (clips) => {
        const next = [...clips];
        next.splice(location.clipIndex, 1, left, right);
        return next;
      });
      return { ...state, tracks, selectedClipId: left.id };
    }

    case "TRIM_CLIP": {
      const tracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== action.id) return c;
          let inPoint = action.inPoint ?? c.inPoint;
          let outPoint = action.outPoint ?? c.outPoint;
          inPoint = Math.max(0, Math.min(inPoint, outPoint - MIN_CLIP_LENGTH));
          outPoint = Math.min(c.sourceDuration, Math.max(outPoint, inPoint + MIN_CLIP_LENGTH));
          return { ...c, inPoint, outPoint };
        }),
      }));
      return { ...state, tracks };
    }

    case "SET_TRANSFORM": {
      const tracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === action.id ? { ...c, transform: { ...c.transform, ...action.patch } } : c)),
      }));
      return { ...state, tracks };
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
