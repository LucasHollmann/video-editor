import { useReducer } from "react";
import { type Clip, timelineDuration } from "./types";

export interface EditorState {
  clips: Clip[];
  selectedClipId: string | null;
  playhead: number;
  seekVersion: number;
}

type Action =
  | { type: "ADD_CLIP"; clip: Clip }
  | { type: "SELECT_CLIP"; id: string | null }
  | { type: "DELETE_CLIP"; id: string }
  | { type: "SPLIT_CLIP"; id: string; atLocalTime: number }
  | { type: "TRIM_CLIP"; id: string; inPoint?: number; outPoint?: number }
  | { type: "SET_PLAYHEAD"; time: number; fromPlayback?: boolean };

const initialState: EditorState = {
  clips: [],
  selectedClipId: null,
  playhead: 0,
  seekVersion: 0,
};

const MIN_CLIP_LENGTH = 0.1;

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "ADD_CLIP":
      return {
        ...state,
        clips: [...state.clips, action.clip],
        selectedClipId: action.clip.id,
        playhead: timelineDuration(state.clips),
        seekVersion: state.seekVersion + 1,
      };

    case "SELECT_CLIP":
      return { ...state, selectedClipId: action.id };

    case "DELETE_CLIP":
      return {
        ...state,
        clips: state.clips.filter((c) => c.id !== action.id),
        selectedClipId: state.selectedClipId === action.id ? null : state.selectedClipId,
      };

    case "SPLIT_CLIP": {
      const index = state.clips.findIndex((c) => c.id === action.id);
      if (index === -1) return state;
      const clip = state.clips[index];
      const splitAt = clip.inPoint + action.atLocalTime;
      if (splitAt <= clip.inPoint + MIN_CLIP_LENGTH || splitAt >= clip.outPoint - MIN_CLIP_LENGTH) {
        return state;
      }
      const left: Clip = { ...clip, outPoint: splitAt };
      const right: Clip = { ...clip, id: crypto.randomUUID(), inPoint: splitAt };
      const clips = [...state.clips];
      clips.splice(index, 1, left, right);
      return { ...state, clips, selectedClipId: left.id };
    }

    case "TRIM_CLIP": {
      return {
        ...state,
        clips: state.clips.map((c) => {
          if (c.id !== action.id) return c;
          let inPoint = action.inPoint ?? c.inPoint;
          let outPoint = action.outPoint ?? c.outPoint;
          inPoint = Math.max(0, Math.min(inPoint, outPoint - MIN_CLIP_LENGTH));
          outPoint = Math.min(c.sourceDuration, Math.max(outPoint, inPoint + MIN_CLIP_LENGTH));
          return { ...c, inPoint, outPoint };
        }),
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
