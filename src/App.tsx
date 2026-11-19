import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import { SegmentInspector } from "./components/SegmentInspector";
import { AssetsPanel } from "./components/AssetsPanel";
import { SegmentsPanel } from "./components/SegmentsPanel";
import { ProjectSetup } from "./components/ProjectSetup";
import { ResizeHandle } from "./components/ResizeHandle";
import { useEditorState } from "./useEditorState";
import {
  DEFAULT_IMAGE_DURATION,
  IMAGE_MAX_DURATION,
  type Asset,
  type AssetKind,
  type Segment,
  type Transform,
  defaultSizingForAsset,
  findSegmentAtTime,
  findSegmentTrack,
  fullFrameTransform,
  resolveTransform,
  resolveVolume,
  segmentDuration,
  totalDuration,
} from "./types";
import "./App.css";

interface MediaInfo {
  duration: number;
  width: number;
  height: number;
}

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm", "m4v"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "aac", "m4a", "ogg", "flac"];

function kindForExtension(path: string): AssetKind | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return null;
}

export default function App() {
  const [state, dispatch] = useEditorState();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [assetsPanelWidth, setAssetsPanelWidth] = useState(220);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [timelineHeight, setTimelineHeight] = useState(260);

  const duration = totalDuration(state.tracks);
  const selectedTrack = state.tracks.find((t) => t.id === state.selectedTrackId) ?? state.tracks[0] ?? null;
  const selectedSegment = state.tracks.flatMap((t) => t.segments).find((s) => s.id === state.selectedSegmentId) ?? null;
  const selectedAsset = selectedSegment ? (state.assets.find((a) => a.id === selectedSegment.assetId) ?? null) : null;
  const selectedSegmentLocalTime = selectedSegment
    ? Math.min(Math.max(state.playhead - selectedSegment.start, 0), segmentDuration(selectedSegment))
    : null;
  const activeKeyframe =
    selectedSegment && state.selectedKeyframeId
      ? (selectedSegment.keyframes.find((k) => k.id === state.selectedKeyframeId) ?? null)
      : null;
  // What the "segment options" sections should display/edit right now: the
  // selected keyframe's own values, or — with no keyframe selected — whatever
  // the segment's animation actually resolves to at the current playhead
  // (interpolated between keyframes, or the static transform with none at all).
  const effectiveTransform: Transform | null = !selectedSegment
    ? null
    : activeKeyframe
      ? {
          x: activeKeyframe.x,
          y: activeKeyframe.y,
          width: activeKeyframe.width,
          height: activeKeyframe.height,
          opacity: activeKeyframe.opacity,
          rotation: activeKeyframe.rotation,
        }
      : resolveTransform(selectedSegment, selectedSegmentLocalTime ?? 0);
  const effectiveVolume: number | null = !selectedSegment
    ? null
    : activeKeyframe
      ? activeKeyframe.volume
      : resolveVolume(selectedSegment, selectedSegmentLocalTime ?? 0);

  // Keep the playhead inside the timeline whenever segments are trimmed/removed.
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

  function handleCreateProject(width: number, height: number) {
    dispatch({ type: "CREATE_PROJECT", width, height });
  }

  async function handleImportAssets() {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "Mídia", extensions: [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS] },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const path of paths) {
      const kind = kindForExtension(path);
      if (!kind) continue;
      const name = path.split(/[\\/]/).pop() ?? path;
      try {
        if (kind === "image") {
          let width: number | undefined;
          let height: number | undefined;
          try {
            const info = await invoke<MediaInfo>("probe_media", { path });
            width = info.width || undefined;
            height = info.height || undefined;
          } catch {
            // Dimensions unknown; the segment falls back to stretch-to-box sizing.
          }
          const asset: Asset = { id: crypto.randomUUID(), kind, sourcePath: path, name, duration: IMAGE_MAX_DURATION, width, height };
          dispatch({ type: "ADD_ASSET", asset });
        } else {
          const info = await invoke<MediaInfo>("probe_media", { path });
          const asset: Asset = {
            id: crypto.randomUUID(),
            kind,
            sourcePath: path,
            name,
            duration: info.duration,
            width: info.width || undefined,
            height: info.height || undefined,
          };
          dispatch({ type: "ADD_ASSET", asset });
        }
      } catch (err) {
        setErrorMessage(String(err));
      }
    }
  }

  function handleDropAsset(assetId: string, trackId: string, start: number) {
    const asset = state.assets.find((a) => a.id === assetId);
    if (!asset || !state.project) return;
    const trackIndex = state.tracks.findIndex((t) => t.id === trackId);
    const depthFromBack = state.tracks.length - 1 - trackIndex;
    const outPoint = asset.kind === "image" ? DEFAULT_IMAGE_DURATION : asset.duration;
    const { transform, sizeMode } =
      asset.kind === "audio"
        ? {
            transform: fullFrameTransform(state.project.width, state.project.height),
            sizeMode: { lockAspectRatio: false, scaleAxes: { width: true, height: false } },
          }
        : defaultSizingForAsset(
            depthFromBack,
            state.project.width,
            state.project.height,
            asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined,
          );
    const segment: Segment = {
      id: crypto.randomUUID(),
      assetId: asset.id,
      kind: asset.kind,
      start,
      inPoint: 0,
      outPoint,
      transform,
      sizeMode,
      keyframes: [],
      volume: 1,
    };
    dispatch({ type: "ADD_SEGMENT", trackId, segment });
  }

  function handleMoveSegment(id: string, trackId: string, start: number) {
    dispatch({ type: "MOVE_SEGMENT", id, trackId, start });
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
    if (state.tracks.every((t) => t.segments.length === 0)) return;
    setIsPlaying((playing) => !playing);
  }

  function handleSplit() {
    if (!selectedTrack) return;
    const segment = findSegmentAtTime(selectedTrack.segments, state.playhead);
    if (!segment) return;
    dispatch({ type: "SPLIT_SEGMENT", id: segment.id, atLocalTime: state.playhead - segment.start });
  }

  function handleDelete() {
    if (!state.selectedSegmentId) return;
    dispatch({ type: "DELETE_SEGMENT", id: state.selectedSegmentId });
  }

  function handleSeek(time: number) {
    setIsPlaying(false);
    dispatch({ type: "SET_PLAYHEAD", time });
  }

  function handleSelectSegment(id: string | null, trackId: string | null) {
    dispatch({ type: "SELECT_SEGMENT", id });
    if (trackId) dispatch({ type: "SELECT_TRACK", id: trackId });
  }

  function handleTrim(id: string, patch: { inPoint?: number; outPoint?: number }) {
    dispatch({ type: "TRIM_SEGMENT", id, ...patch });
  }

  function handleChangeTransform(id: string, patch: Partial<Transform>) {
    if (!selectedSegment || selectedSegment.id !== id) return;

    // Keep width/height linked while the aspect ratio is locked, regardless of
    // whether this edit lands on the base transform or on a keyframe.
    const asset = state.assets.find((a) => a.id === selectedSegment.assetId);
    const natural = asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null;
    let finalPatch = patch;
    if (selectedSegment.sizeMode.lockAspectRatio && natural) {
      if (patch.width != null && patch.height == null) {
        finalPatch = { ...patch, height: Math.round(patch.width * (natural.height / natural.width)) };
      } else if (patch.height != null && patch.width == null) {
        finalPatch = { ...patch, width: Math.round(patch.height * (natural.width / natural.height)) };
      }
    }

    if (state.selectedKeyframeId) {
      dispatch({ type: "UPDATE_KEYFRAME", id, keyframeId: state.selectedKeyframeId, patch: finalPatch });
      return;
    }
    if (selectedSegment.keyframes.length > 0) {
      // No keyframe selected, but the segment is already animated: editing a
      // value now should create a new keyframe at the current time instead of
      // touching the (otherwise ignored) base transform.
      const localTime = selectedSegmentLocalTime ?? 0;
      const data = {
        ...resolveTransform(selectedSegment, localTime),
        volume: resolveVolume(selectedSegment, localTime),
        ...finalPatch,
      };
      dispatch({ type: "ADD_KEYFRAME", id, time: localTime, data });
      return;
    }
    dispatch({ type: "SET_TRANSFORM", id, patch: finalPatch });
  }

  function handleChangeVolume(id: string, volume: number) {
    if (!selectedSegment || selectedSegment.id !== id) return;

    if (state.selectedKeyframeId) {
      dispatch({ type: "UPDATE_KEYFRAME", id, keyframeId: state.selectedKeyframeId, patch: { volume } });
      return;
    }
    if (selectedSegment.keyframes.length > 0) {
      const localTime = selectedSegmentLocalTime ?? 0;
      const data = { ...resolveTransform(selectedSegment, localTime), volume };
      dispatch({ type: "ADD_KEYFRAME", id, time: localTime, data });
      return;
    }
    dispatch({ type: "SET_VOLUME", id, volume });
  }

  function handleSetAspectLock(id: string, locked: boolean) {
    dispatch({ type: "SET_ASPECT_LOCK", id, locked });
  }

  function handleSetScaleAxis(id: string, axis: "width" | "height", checked: boolean) {
    dispatch({ type: "SET_SCALE_AXIS", id, axis, checked });
  }

  function handleApplyScaleToCanvas(id: string) {
    if (!state.project || !selectedSegment || selectedSegment.id !== id || !effectiveTransform) return;
    const asset = state.assets.find((a) => a.id === selectedSegment.assetId);
    const natural = asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null;
    const { width: fitWidth, height: fitHeight } = selectedSegment.sizeMode.scaleAxes;

    let width = effectiveTransform.width;
    let height = effectiveTransform.height;
    if (fitWidth && fitHeight) {
      // Both axes pinned: stretch to fill the canvas, distorting if needed.
      width = state.project.width;
      height = state.project.height;
    } else if (fitWidth) {
      width = state.project.width;
      if (natural) height = Math.round(width * (natural.height / natural.width));
    } else if (fitHeight) {
      height = state.project.height;
      if (natural) width = Math.round(height * (natural.width / natural.height));
    }
    handleChangeTransform(id, { width, height });
  }

  function handleChangeDuration(id: string, outPoint: number) {
    dispatch({ type: "TRIM_SEGMENT", id, outPoint });
  }

  function handleChangeStart(id: string, start: number) {
    const track = findSegmentTrack(state.tracks, id);
    if (!track) return;
    dispatch({ type: "MOVE_SEGMENT", id, trackId: track.id, start });
  }

  function handleSplitAudio(id: string) {
    dispatch({ type: "SPLIT_AUDIO", id });
  }

  function handleAddKeyframe() {
    if (!selectedSegment || selectedSegmentLocalTime == null) return;
    const data = {
      ...resolveTransform(selectedSegment, selectedSegmentLocalTime),
      volume: resolveVolume(selectedSegment, selectedSegmentLocalTime),
    };
    dispatch({ type: "ADD_KEYFRAME", id: selectedSegment.id, time: selectedSegmentLocalTime, data });
  }

  function handleSelectKeyframe(keyframeId: string | null) {
    dispatch({ type: "SELECT_KEYFRAME", id: keyframeId });
  }

  function handleChangeKeyframeTime(keyframeId: string, time: number) {
    if (!selectedSegment) return;
    dispatch({ type: "UPDATE_KEYFRAME", id: selectedSegment.id, keyframeId, patch: { time } });
  }

  function handleDeleteKeyframe(keyframeId: string) {
    if (!selectedSegment) return;
    dispatch({ type: "DELETE_KEYFRAME", id: selectedSegment.id, keyframeId });
  }

  function handleCloseInspector() {
    dispatch({ type: "SELECT_SEGMENT", id: null });
  }

  async function handleExport() {
    if (!state.project || state.tracks.every((t) => t.segments.length === 0)) return;
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
          clips: t.segments.map((s) => {
            const asset = state.assets.find((a) => a.id === s.assetId);
            return {
              kind: s.kind,
              sourcePath: asset?.sourcePath ?? "",
              start: s.start,
              inPoint: s.inPoint,
              outPoint: s.outPoint,
              transform: s.transform,
              volume: s.volume,
              keyframes: s.keyframes.map((k) => ({
                time: k.time,
                x: k.x,
                y: k.y,
                width: k.width,
                height: k.height,
                opacity: k.opacity,
                rotation: k.rotation,
              })),
            };
          }),
        })),
        outputPath: target,
        canvasWidth: state.project.width,
        canvasHeight: state.project.height,
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

  if (!state.project) {
    return <ProjectSetup onCreate={handleCreateProject} />;
  }

  return (
    <div className="app">
      <Toolbar
        isExporting={isExporting}
        canExport={state.tracks.some((t) => t.segments.length > 0)}
        currentTime={state.playhead}
        totalDuration={duration}
        onExport={handleExport}
      />
      <div className="app-main">
        <div className="assets-panel-container" style={{ width: assetsPanelWidth }}>
          <AssetsPanel assets={state.assets} onImport={handleImportAssets} />
          <ResizeHandle
            axis="horizontal"
            edge="right"
            onDrag={(delta) => setAssetsPanelWidth((w) => Math.min(560, Math.max(160, w + delta)))}
          />
        </div>
        <Preview
          tracks={state.tracks}
          assets={state.assets}
          projectWidth={state.project.width}
          projectHeight={state.project.height}
          playhead={state.playhead}
          seekVersion={state.seekVersion}
          isPlaying={isPlaying}
          onPlayheadChange={handlePlayheadChange}
          onPlayingChange={handlePlayingChange}
        />
        <div className="right-sidebar" style={{ width: sidebarWidth }}>
          <ResizeHandle
            axis="horizontal"
            edge="left"
            onDrag={(delta) => setSidebarWidth((w) => Math.min(640, Math.max(200, w - delta)))}
          />
          {selectedSegment ? (
            <SegmentInspector
              segment={selectedSegment}
              asset={selectedAsset}
              effectiveTransform={effectiveTransform}
              effectiveVolume={effectiveVolume}
              projectWidth={state.project.width}
              projectHeight={state.project.height}
              currentLocalTime={selectedSegmentLocalTime}
              selectedKeyframeId={state.selectedKeyframeId}
              onSeek={handleSeek}
              onChangeTransform={handleChangeTransform}
              onChangeVolume={handleChangeVolume}
              onSplitAudio={handleSplitAudio}
              onChangeDuration={handleChangeDuration}
              onChangeStart={handleChangeStart}
              onSetAspectLock={handleSetAspectLock}
              onSetScaleAxis={handleSetScaleAxis}
              onApplyScaleToCanvas={handleApplyScaleToCanvas}
              onAddKeyframe={handleAddKeyframe}
              onSelectKeyframe={handleSelectKeyframe}
              onChangeKeyframeTime={handleChangeKeyframeTime}
              onDeleteKeyframe={handleDeleteKeyframe}
              onClose={handleCloseInspector}
            />
          ) : (
            <SegmentsPanel
              tracks={state.tracks}
              assets={state.assets}
              selectedSegmentId={state.selectedSegmentId}
              onSelect={(id, trackId) => handleSelectSegment(id, trackId)}
            />
          )}
        </div>
      </div>
      <Timeline
        tracks={state.tracks}
        assets={state.assets}
        playhead={state.playhead}
        height={timelineHeight}
        onResizeHeight={(delta) => setTimelineHeight((h) => Math.min(700, Math.max(140, h + delta)))}
        selectedSegmentId={state.selectedSegmentId}
        selectedTrackId={state.selectedTrackId}
        onSeek={handleSeek}
        onSelectSegment={handleSelectSegment}
        onSelectTrack={handleSelectTrack}
        onTrim={handleTrim}
        onMoveSegment={handleMoveSegment}
        onDropAsset={handleDropAsset}
        onMoveTrackUp={handleMoveTrackUp}
        onMoveTrackDown={handleMoveTrackDown}
        onDeleteTrack={handleDeleteTrack}
        onAddTrack={handleAddTrack}
        isPlaying={isPlaying}
        canSplit={Boolean(selectedTrack && findSegmentAtTime(selectedTrack.segments, state.playhead))}
        canDelete={Boolean(state.selectedSegmentId)}
        onPlayPause={handlePlayPause}
        onSplit={handleSplit}
        onDelete={handleDelete}
      />
      {errorMessage && (
        <div className="error-banner" onClick={() => setErrorMessage(null)}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
