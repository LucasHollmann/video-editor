import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import { type Clip, clipDuration, clipStartOnTimeline, findClipAtTime, timelineDuration } from "../types";

interface Props {
  clips: Clip[];
  playhead: number;
  selectedClipId: string | null;
  onSeek: (time: number) => void;
  onSelect: (id: string | null) => void;
  onTrim: (id: string, patch: { inPoint?: number; outPoint?: number }) => void;
}

const PX_PER_SECOND = 80;
const MIN_TRACK_WIDTH = 640;

type Drag = { type: "scrub" } | { type: "trim"; clipId: string; edge: "in" | "out"; startX: number; startIn: number; startOut: number };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Timeline({ clips, playhead, selectedClipId, onSeek, onSelect, onTrim }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const totalDuration = Math.max(timelineDuration(clips), 1);
  const widthPx = Math.max(totalDuration * PX_PER_SECOND, MIN_TRACK_WIDTH);

  function xToTime(clientX: number) {
    const rect = trackRef.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(x / PX_PER_SECOND, totalDuration));
  }

  function handleTrackPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const time = xToTime(e.clientX);
    onSeek(time);
    const at = findClipAtTime(clips, time);
    onSelect(at ? at.clip.id : null);
    dragRef.current = { type: "scrub" };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleTrackPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.type === "scrub") onSeek(xToTime(e.clientX));
  }

  function handleTrackPointerUp() {
    dragRef.current = null;
  }

  function handleHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>, clip: Clip, edge: "in" | "out") {
    e.stopPropagation();
    dragRef.current = { type: "trim", clipId: clip.id, edge, startX: e.clientX, startIn: clip.inPoint, startOut: clip.outPoint };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleHandlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.type !== "trim") return;
    e.stopPropagation();
    const deltaSeconds = (e.clientX - drag.startX) / PX_PER_SECOND;
    if (drag.edge === "in") onTrim(drag.clipId, { inPoint: drag.startIn + deltaSeconds });
    else onTrim(drag.clipId, { outPoint: drag.startOut + deltaSeconds });
  }

  function handleHandlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    dragRef.current = null;
  }

  const ticks = [];
  for (let t = 0; t <= totalDuration + 1; t++) {
    ticks.push(t);
  }

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <div className="timeline-ruler" style={{ width: widthPx }}>
          {ticks.map((t) => (
            <div key={t} className="ruler-tick" style={{ left: t * PX_PER_SECOND }}>
              {t % 5 === 0 && <span>{formatTime(t)}</span>}
            </div>
          ))}
        </div>
        <div
          ref={trackRef}
          className="timeline-track"
          style={{ width: widthPx }}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
        >
          {clips.map((clip, i) => {
            const left = clipStartOnTimeline(clips, i) * PX_PER_SECOND;
            const width = Math.max(clipDuration(clip) * PX_PER_SECOND, 4);
            const selected = clip.id === selectedClipId;
            return (
              <div key={clip.id} className={`clip-block${selected ? " selected" : ""}`} style={{ left, width }}>
                <div
                  className="trim-handle trim-handle-left"
                  onPointerDown={(e) => handleHandlePointerDown(e, clip, "in")}
                  onPointerMove={handleHandlePointerMove}
                  onPointerUp={handleHandlePointerUp}
                />
                <span className="clip-label">{clip.sourcePath.split(/[\\/]/).pop()}</span>
                <div
                  className="trim-handle trim-handle-right"
                  onPointerDown={(e) => handleHandlePointerDown(e, clip, "out")}
                  onPointerMove={handleHandlePointerMove}
                  onPointerUp={handleHandlePointerUp}
                />
              </div>
            );
          })}
          <div className="playhead" style={{ left: playhead * PX_PER_SECOND }} />
        </div>
      </div>
    </div>
  );
}
