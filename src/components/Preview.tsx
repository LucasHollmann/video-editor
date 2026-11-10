import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type Clip, clipDuration, clipStartOnTimeline, findClipAtTime } from "../types";

interface Props {
  clips: Clip[];
  playhead: number;
  seekVersion: number;
  isPlaying: boolean;
  onPlayheadChange: (time: number, fromPlayback?: boolean) => void;
  onPlayingChange: (playing: boolean) => void;
}

const EPS = 0.05;

export function Preview({ clips, playhead, seekVersion, isPlaying, onPlayheadChange, onPlayingChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedSrcRef = useRef<string | null>(null);
  const activeIndexRef = useRef(0);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  // Explicit seeks: timeline clicks/drags, split, trim, delete, or an initial clip import.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const at = findClipAtTime(clips, playheadRef.current);
    if (!at) {
      video.removeAttribute("src");
      loadedSrcRef.current = null;
      return;
    }
    activeIndexRef.current = at.index;
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
    // Re-run whenever clip list is edited (new array reference) or a manual seek bumps seekVersion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekVersion, clips]);

  // Play/pause toggle.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) video.play().catch(() => {});
    else video.pause();
  }, [isPlaying]);

  // Drive playhead from native playback, and hop to the next clip when one ends.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const index = activeIndexRef.current;
      const clip = clips[index];
      if (!clip) return;

      if (video.currentTime >= clip.outPoint - EPS) {
        const nextIndex = index + 1;
        const nextClip = clips[nextIndex];
        if (isPlaying && nextClip) {
          activeIndexRef.current = nextIndex;
          const url = convertFileSrc(nextClip.sourcePath);
          loadedSrcRef.current = url;
          video.src = url;
          const onLoaded = () => {
            video.currentTime = nextClip.inPoint;
            video.play().catch(() => {});
            video.removeEventListener("loadedmetadata", onLoaded);
          };
          video.addEventListener("loadedmetadata", onLoaded);
          onPlayheadChange(clipStartOnTimeline(clips, nextIndex), true);
        } else {
          video.pause();
          onPlayingChange(false);
          onPlayheadChange(clipStartOnTimeline(clips, index) + clipDuration(clip), true);
        }
        return;
      }

      onPlayheadChange(clipStartOnTimeline(clips, index) + (video.currentTime - clip.inPoint), true);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [clips, isPlaying, onPlayheadChange, onPlayingChange]);

  return (
    <div className="preview">
      <video ref={videoRef} className="preview-video" />
      {clips.length === 0 && <div className="preview-empty">Importe um vídeo para começar</div>}
    </div>
  );
}
