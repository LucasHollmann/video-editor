import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import { Inspector } from "./components/Inspector";
import { useEditorState } from "./useEditorState";
import {
  DEFAULT_IMAGE_DURATION,
  IMAGE_MAX_DURATION,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  type Transform,
  activeClipAt,
  defaultTransformForTrackIndex,
  totalDuration,
} from "./types";
import "./App.css";

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

export default function App() {
  const [state, dispatch] = useEditorState();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const duration = totalDuration(state.tracks);
  const selectedTrack = state.tracks.find((t) => t.id === state.selectedTrackId) ?? state.tracks[0] ?? null;
  const selectedClip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === state.selectedClipId) ?? null;

  // Keep the playhead inside the timeline whenever clips are trimmed/removed.
  useEffect(() => {
    if (state.playhead > duration) {
      dispatch({ type: "SET_PLAYHEAD", time: duration });
    }
  }, [state.tracks, state.playhead, duration, dispatch]);

  const handlePlayheadChange = useCallback(
    (time: number, fromPlayback?: boolean) => dispatch({ type: "SET_PLAYHEAD", time, fromPlayback }),
    [dispatch],
  );
  const handlePlayingChange = useCallback((playing: boolean) => setIsPlaying(playing), []);

  async function handleImportVideo() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Vídeo", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] }],
    });
    if (!selected || Array.isArray(selected) || !selectedTrack) return;
    try {
      const info = await invoke<VideoInfo>("probe_video", { path: selected });
      const trackIndex = state.tracks.findIndex((t) => t.id === selectedTrack.id);
      dispatch({
        type: "ADD_CLIP",
        trackId: selectedTrack.id,
        clip: {
          id: crypto.randomUUID(),
          kind: "video",
          sourcePath: selected,
          sourceDuration: info.duration,
          inPoint: 0,
          outPoint: info.duration,
          transform: defaultTransformForTrackIndex(trackIndex),
        },
      });
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  async function handleAddImage() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Imagem", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
    });
    if (!selected || Array.isArray(selected) || !selectedTrack) return;
    const trackIndex = state.tracks.findIndex((t) => t.id === selectedTrack.id);
    dispatch({
      type: "ADD_CLIP",
      trackId: selectedTrack.id,
      clip: {
        id: crypto.randomUUID(),
        kind: "image",
        sourcePath: selected,
        sourceDuration: IMAGE_MAX_DURATION,
        inPoint: 0,
        outPoint: DEFAULT_IMAGE_DURATION,
        transform: defaultTransformForTrackIndex(trackIndex),
      },
    });
  }

  function handleAddTrack() {
    dispatch({ type: "ADD_TRACK" });
  }

  function handleMoveTrackUp(id: string) {
    dispatch({ type: "MOVE_TRACK_UP", id });
  }

  function handleMoveTrackDown(id: string) {
    dispatch({ type: "MOVE_TRACK_DOWN", id });
  }

  function handleDeleteTrack(id: string) {
    dispatch({ type: "DELETE_TRACK", id });
  }

  function handleSelectTrack(id: string) {
    dispatch({ type: "SELECT_TRACK", id });
  }

  function handlePlayPause() {
    if (state.tracks.every((t) => t.clips.length === 0)) return;
    setIsPlaying((playing) => !playing);
  }

  function handleSplit() {
    if (!selectedTrack) return;
    const at = activeClipAt(selectedTrack.clips, state.playhead);
    if (!at) return;
    dispatch({ type: "SPLIT_CLIP", id: at.clip.id, atLocalTime: at.localTime });
  }

  function handleDelete() {
    if (!state.selectedClipId) return;
    dispatch({ type: "DELETE_CLIP", id: state.selectedClipId });
  }

  function handleSeek(time: number) {
    setIsPlaying(false);
    dispatch({ type: "SET_PLAYHEAD", time });
  }

  function handleSelectClip(id: string | null, trackId: string | null) {
    dispatch({ type: "SELECT_CLIP", id });
    if (trackId) dispatch({ type: "SELECT_TRACK", id: trackId });
  }

  function handleTrim(id: string, patch: { inPoint?: number; outPoint?: number }) {
    dispatch({ type: "TRIM_CLIP", id, ...patch });
  }

  function handleTransformChange(id: string, patch: Partial<Transform>) {
    dispatch({ type: "SET_TRANSFORM", id, patch });
  }

  async function handleExport() {
    if (state.tracks.every((t) => t.clips.length === 0)) return;
    const target = await save({
      defaultPath: "output.mp4",
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (!target) return;
    setIsExporting(true);
    setErrorMessage(null);
    try {
      await invoke("export_timeline", {
        tracks: state.tracks.map((t) => ({
          clips: t.clips.map((c) => ({
            kind: c.kind,
            sourcePath: c.sourcePath,
            inPoint: c.inPoint,
            outPoint: c.outPoint,
            transform: c.transform,
          })),
        })),
        outputPath: target,
        canvasWidth: PROJECT_WIDTH,
        canvasHeight: PROJECT_HEIGHT,
      });
    } catch (err) {
      setErrorMessage(String(err));
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === "s" || e.key === "S") {
        handleSplit();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        handleDelete();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className="app">
      <Toolbar
        isPlaying={isPlaying}
        isExporting={isExporting}
        canSplit={Boolean(selectedTrack && activeClipAt(selectedTrack.clips, state.playhead))}
        canDelete={Boolean(state.selectedClipId)}
        canExport={state.tracks.some((t) => t.clips.length > 0)}
        currentTime={state.playhead}
        totalDuration={duration}
        onImport={handleImportVideo}
        onAddImage={handleAddImage}
        onAddTrack={handleAddTrack}
        onPlayPause={handlePlayPause}
        onSplit={handleSplit}
        onDelete={handleDelete}
        onExport={handleExport}
      />
      <Preview
        tracks={state.tracks}
        playhead={state.playhead}
        seekVersion={state.seekVersion}
        isPlaying={isPlaying}
        onPlayheadChange={handlePlayheadChange}
        onPlayingChange={handlePlayingChange}
      />
      <Inspector clip={selectedClip} onChange={handleTransformChange} />
      <Timeline
        tracks={state.tracks}
        playhead={state.playhead}
        selectedClipId={state.selectedClipId}
        selectedTrackId={state.selectedTrackId}
        onSeek={handleSeek}
        onSelectClip={handleSelectClip}
        onSelectTrack={handleSelectTrack}
        onTrim={handleTrim}
        onMoveTrackUp={handleMoveTrackUp}
        onMoveTrackDown={handleMoveTrackDown}
        onDeleteTrack={handleDeleteTrack}
      />
      {errorMessage && (
        <div className="error-banner" onClick={() => setErrorMessage(null)}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
