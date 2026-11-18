import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type ClipAtTime, type Track, PROJECT_HEIGHT, PROJECT_WIDTH, activeClipAt, totalDuration } from "../types";

interface Props {
  tracks: Track[];
  playhead: number;
  seekVersion: number;
  isPlaying: boolean;
  onPlayheadChange: (time: number, fromPlayback?: boolean) => void;
  onPlayingChange: (playing: boolean) => void;
}

interface LayerProps {
  at: ClipAtTime | null;
  isPlaying: boolean;
  seekVersion: number;
  zIndex: number;
}

function Layer({ at, isPlaying, seekVersion, zIndex }: LayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedSrcRef = useRef<string | null>(null);

  // Explicit resync: fires when the active clip changes or on a manual seek/edit (seekVersion bump).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!at || at.clip.kind !== "video") {
      video.pause();
      return;
    }
    const url = convertFileSrc(at.clip.sourcePath);
    const targetTime = at.clip.inPoint + at.localTime;
    if (loadedSrcRef.current !== url) {
      loadedSrcRef.current = url;
      video.src = url;
      const onLoaded = () => {
        video.currentTime = targetTime;
        if (isPlaying) video.play().catch(() => {});
        video.removeEventListener("loadedmetadata", onLoaded);
      };
      video.addEventListener("loadedmetadata", onLoaded);
    } else {
      video.currentTime = targetTime;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.clip.id, seekVersion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || at?.clip.kind !== "video") return;
    if (isPlaying) video.play().catch(() => {});
    else video.pause();
  }, [isPlaying, at?.clip.kind]);

  const transform = at?.clip.transform;
  const style = transform
    ? {
        left: `${(transform.x / PROJECT_WIDTH) * 100}%`,
        top: `${(transform.y / PROJECT_HEIGHT) * 100}%`,
        width: `${(transform.width / PROJECT_WIDTH) * 100}%`,
        height: `${(transform.height / PROJECT_HEIGHT) * 100}%`,
        opacity: transform.opacity,
        zIndex,
      }
    : undefined;

  const showVideo = at?.clip.kind === "video";

  return (
    <>
      <video ref={videoRef} className="preview-layer" style={{ ...style, display: showVideo ? "block" : "none" }} />
      {at && at.clip.kind === "image" && (
        <img src={convertFileSrc(at.clip.sourcePath)} className="preview-layer" style={style} />
      )}
    </>
  );
}

export function Preview({ tracks, playhead, seekVersion, isPlaying, onPlayheadChange, onPlayingChange }: Props) {
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const duration = totalDuration(tracks);

  // Drives the playhead at wall-clock speed while playing; individual <video> elements
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

  const hasContent = tracks.some((t) => t.clips.length > 0);

  return (
    <div className="preview">
      <div className="preview-canvas" style={{ aspectRatio: `${PROJECT_WIDTH} / ${PROJECT_HEIGHT}` }}>
        {tracks.map((track, i) => (
          <Layer
            key={track.id}
            at={activeClipAt(track.clips, playhead)}
            isPlaying={isPlaying}
            seekVersion={seekVersion}
            zIndex={i + 1}
          />
        ))}
        {!hasContent && <div className="preview-empty">Importe um vídeo ou imagem para começar</div>}
      </div>
    </div>
  );
}
