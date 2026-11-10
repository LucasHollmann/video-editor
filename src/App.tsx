import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import { useEditorState } from "./useEditorState";
import { findClipAtTime, timelineDuration } from "./types";
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

  const totalDuration = timelineDuration(state.clips);

  // Keep the playhead inside the timeline whenever clips are trimmed/removed.
  useEffect(() => {
    if (state.playhead > totalDuration) {
      dispatch({ type: "SET_PLAYHEAD", time: totalDuration });
    }
  }, [state.clips, state.playhead, totalDuration, dispatch]);

  const handlePlayheadChange = useCallback(
    (time: number, fromPlayback?: boolean) => dispatch({ type: "SET_PLAYHEAD", time, fromPlayback }),
    [dispatch],
  );
  const handlePlayingChange = useCallback((playing: boolean) => setIsPlaying(playing), []);

  async function handleImport() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Vídeo", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const info = await invoke<VideoInfo>("probe_video", { path: selected });
      dispatch({
        type: "ADD_CLIP",
        clip: {
          id: crypto.randomUUID(),
          sourcePath: selected,
          sourceDuration: info.duration,
          inPoint: 0,
          outPoint: info.duration,
        },
      });
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  function handlePlayPause() {
    if (state.clips.length === 0) return;
    setIsPlaying((playing) => !playing);
  }

  function handleSplit() {
    const at = findClipAtTime(state.clips, state.playhead);
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

  function handleSelect(id: string | null) {
    dispatch({ type: "SELECT_CLIP", id });
  }

  function handleTrim(id: string, patch: { inPoint?: number; outPoint?: number }) {
    dispatch({ type: "TRIM_CLIP", id, ...patch });
  }

  async function handleExport() {
    if (state.clips.length === 0) return;
    const target = await save({
      defaultPath: "output.mp4",
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (!target) return;
    setIsExporting(true);
    setErrorMessage(null);
    try {
      await invoke("export_timeline", {
        clips: state.clips.map((c) => ({
          sourcePath: c.sourcePath,
          inPoint: c.inPoint,
          outPoint: c.outPoint,
        })),
        outputPath: target,
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
        canSplit={Boolean(findClipAtTime(state.clips, state.playhead))}
        canDelete={Boolean(state.selectedClipId)}
        canExport={state.clips.length > 0}
        currentTime={state.playhead}
        totalDuration={totalDuration}
        onImport={handleImport}
        onPlayPause={handlePlayPause}
        onSplit={handleSplit}
        onDelete={handleDelete}
        onExport={handleExport}
      />
      <Preview
        clips={state.clips}
        playhead={state.playhead}
        seekVersion={state.seekVersion}
        isPlaying={isPlaying}
        onPlayheadChange={handlePlayheadChange}
        onPlayingChange={handlePlayingChange}
      />
      <Timeline
        clips={state.clips}
        playhead={state.playhead}
        selectedClipId={state.selectedClipId}
        onSeek={handleSeek}
        onSelect={handleSelect}
        onTrim={handleTrim}
      />
      {errorMessage && (
        <div className="error-banner" onClick={() => setErrorMessage(null)}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
