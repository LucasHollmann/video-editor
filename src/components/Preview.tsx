import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type Asset,
  type SegmentAtTime,
  type Track,
  activeSegmentAt,
  resolveTransform,
  resolveVolume,
  totalDuration,
} from "../types";

interface Props {
  tracks: Track[];
  assets: Asset[];
  projectWidth: number;
  projectHeight: number;
  playhead: number;
  seekVersion: number;
  isPlaying: boolean;
  onPlayheadChange: (time: number, fromPlayback?: boolean) => void;
  onPlayingChange: (playing: boolean) => void;
}

interface LayerProps {
  at: SegmentAtTime | null;
  asset: Asset | null;
  isPlaying: boolean;
  seekVersion: number;
  zIndex: number;
  projectWidth: number;
  projectHeight: number;
}

function Layer({ at, asset, isPlaying, seekVersion, zIndex, projectWidth, projectHeight }: LayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const loadedSrcRef = useRef<string | null>(null);

  const kind = at?.segment.kind ?? null;

  // Explicit resync: fires when the active segment changes or on a manual seek/edit (seekVersion bump).
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (kind !== "video" && video) video.pause();
    if (kind !== "audio" && audio) audio.pause();
    if (!at || !asset || (kind !== "video" && kind !== "audio")) return;

    const mediaEl = kind === "video" ? video : audio;
    if (!mediaEl) return;
    const url = convertFileSrc(asset.sourcePath);
    const targetTime = at.segment.inPoint + at.localTime;
    if (loadedSrcRef.current !== url) {
      loadedSrcRef.current = url;
      mediaEl.src = url;
      const onLoaded = () => {
        mediaEl.currentTime = targetTime;
        if (isPlaying) mediaEl.play().catch(() => {});
        mediaEl.removeEventListener("loadedmetadata", onLoaded);
      };
      mediaEl.addEventListener("loadedmetadata", onLoaded);
    } else {
      mediaEl.currentTime = targetTime;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.segment.id, seekVersion]);

  useEffect(() => {
    const mediaEl = kind === "video" ? videoRef.current : kind === "audio" ? audioRef.current : null;
    if (!mediaEl) return;
    if (isPlaying) mediaEl.play().catch(() => {});
    else mediaEl.pause();
  }, [isPlaying, kind]);

  const resolvedVolume = at ? resolveVolume(at.segment, at.localTime) : 1;

  useEffect(() => {
    const mediaEl = kind === "video" ? videoRef.current : kind === "audio" ? audioRef.current : null;
    if (mediaEl) mediaEl.volume = Math.min(1, Math.max(0, resolvedVolume));
  }, [kind, resolvedVolume]);

  const transform = at ? resolveTransform(at.segment, at.localTime) : null;
  const style = transform
    ? {
        left: `${(transform.x / projectWidth) * 100}%`,
        top: `${(transform.y / projectHeight) * 100}%`,
        width: `${(transform.width / projectWidth) * 100}%`,
        height: `${(transform.height / projectHeight) * 100}%`,
        opacity: transform.opacity,
        transform: `rotate(${transform.rotation}deg)`,
        zIndex,
      }
    : undefined;

  const showVideo = kind === "video";

  return (
    <>
      <video ref={videoRef} className="preview-layer" style={{ ...style, display: showVideo ? "block" : "none" }} />
      <audio ref={audioRef} style={{ display: "none" }} />
      {at && asset && kind === "image" && <img src={convertFileSrc(asset.sourcePath)} className="preview-layer" style={style} />}
    </>
  );
}

export function Preview({
  tracks,
  assets,
  projectWidth,
  projectHeight,
  playhead,
  seekVersion,
  isPlaying,
  onPlayheadChange,
  onPlayingChange,
}: Props) {
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const duration = totalDuration(tracks);

  // Drives the playhead at wall-clock speed while playing; individual media elements
  // play natively in parallel and stay in sync without being polled every frame.
  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = null;
      return;
    }
    function tick(now: number) {
      if (lastFrameRef.current == null) lastFrameRef.current = now;
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      const next = playheadRef.current + dt;
      if (next >= duration) {
        onPlayheadChange(duration, true);
        onPlayingChange(false);
        return;
      }
      onPlayheadChange(next, true);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, duration, onPlayheadChange, onPlayingChange]);

  const hasContent = tracks.some((t) => t.segments.length > 0);

  return (
    <div className="preview">
      <div className="preview-canvas" style={{ aspectRatio: `${projectWidth} / ${projectHeight}` }}>
        {tracks.map((track, i) => {
          const at = activeSegmentAt(track.segments, playhead);
          const asset = at ? (assets.find((a) => a.id === at.segment.assetId) ?? null) : null;
          return (
            <Layer
              key={track.id}
              at={at}
              asset={asset}
              isPlaying={isPlaying}
              seekVersion={seekVersion}
              zIndex={tracks.length - i}
              projectWidth={projectWidth}
              projectHeight={projectHeight}
            />
          );
        })}
        {!hasContent && <div className="preview-empty">Arraste um asset para a timeline para começar</div>}
      </div>
    </div>
  );
}
