import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import {
  type Clip,
  type Track,
  activeClipAt,
  clipDuration,
  clipStartOnTimeline,
  totalDuration,
} from "../types";

interface Props {
  tracks: Track[];
  playhead: number;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  onSeek: (time: number) => void;
  onSelectClip: (id: string | null, trackId: string | null) => void;
  onSelectTrack: (id: string) => void;
  onTrim: (id: string, patch: { inPoint?: number; outPoint?: number }) => void;
  onMoveTrackUp: (id: string) => void;
  onMoveTrackDown: (id: string) => void;
  onDeleteTrack: (id: string) => void;
}

const PX_PER_SECOND = 80;
const MIN_TRACK_WIDTH = 640;
const HEADER_WIDTH = 140;

type Drag = { type: "scrub" } | { type: "trim"; clipId: string; edge: "in" | "out"; startX: number; startIn: number; startOut: number };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Timeline({
  tracks,
  playhead,
  selectedClipId,
  selectedTrackId,
  onSeek,
  onSelectClip,
  onSelectTrack,
  onTrim,
  onMoveTrackUp,
  onMoveTrackDown,
  onDeleteTrack,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const duration = Math.max(totalDuration(tracks), 1);
  const widthPx = Math.max(duration * PX_PER_SECOND, MIN_TRACK_WIDTH);

  function xToTime(clientX: number) {
    const rect = gridRef.current!.getBoundingClientRect();
    const x = clientX - rect.left - HEADER_WIDTH + gridRef.current!.scrollLeft;
    return Math.max(0, Math.min(x / PX_PER_SECOND, duration));
  }

  function handleRowPointerDown(e: ReactPointerEvent<HTMLDivElement>, track: Track) {
    const time = xToTime(e.clientX);
    onSeek(time);
    const at = activeClipAt(track.clips, time);
    onSelectClip(at ? at.clip.id : null, track.id);
    onSelectTrack(track.id);
    dragRef.current = { type: "scrub" };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleRowPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.type === "scrub") onSeek(xToTime(e.clientX));
  }

  function handleRowPointerUp() {
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
  for (let t = 0; t <= duration + 1; t++) {
    ticks.push(t);
  }

  return (
    <div className="timeline">
      <div ref={gridRef} className="timeline-grid">
        <div className="timeline-row timeline-ruler-row">
          <div className="track-header sticky-col" />
          <div className="timeline-ruler" style={{ width: widthPx }}>
            {ticks.map((t) => (
              <div key={t} className="ruler-tick" style={{ left: t * PX_PER_SECOND }}>
                {t % 5 === 0 && <span>{formatTime(t)}</span>}
              </div>
            ))}
          </div>
        </div>
        {tracks.map((track, i) => (
          <div className="timeline-row" key={track.id}>
            <div
              className={`track-header sticky-col${track.id === selectedTrackId ? " selected" : ""}`}
              onClick={() => onSelectTrack(track.id)}
            >
              <span className="track-header-name">{track.name}</span>
              <div className="track-header-actions">
                <button
                  title="Mover para cima"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveTrackUp(track.id);
                  }}
                >
                  ▲
                </button>
                <button
                  title="Mover para baixo"
                  disabled={i === tracks.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveTrackDown(track.id);
                  }}
                >
                  ▼
                </button>
                <button
                  title="Remover camada"
                  disabled={tracks.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTrack(track.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div
              className={`timeline-track${track.id === selectedTrackId ? " selected" : ""}`}
              style={{ width: widthPx }}
              onPointerDown={(e) => handleRowPointerDown(e, track)}
              onPointerMove={handleRowPointerMove}
              onPointerUp={handleRowPointerUp}
            >
              {track.clips.map((clip, ci) => {
                const left = clipStartOnTimeline(track.clips, ci) * PX_PER_SECOND;
                const width = Math.max(clipDuration(clip) * PX_PER_SECOND, 4);
                const selected = clip.id === selectedClipId;
                return (
                  <div
                    key={clip.id}
                    className={`clip-block clip-${clip.kind}${selected ? " selected" : ""}`}
                    style={{ left, width }}
                  >
                    <div
                      className="trim-handle trim-handle-left"
                      onPointerDown={(e) => handleHandlePointerDown(e, clip, "in")}
                      onPointerMove={handleHandlePointerMove}
                      onPointerUp={handleHandlePointerUp}
                    />
                    <span className="clip-label">
                      {clip.kind === "image" ? "🖼 " : ""}
                      {clip.sourcePath.split(/[\\/]/).pop()}
                    </span>
                    <div
                      className="trim-handle trim-handle-right"
                      onPointerDown={(e) => handleHandlePointerDown(e, clip, "out")}
                      onPointerMove={handleHandlePointerMove}
                      onPointerUp={handleHandlePointerUp}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="playhead" style={{ left: HEADER_WIDTH + playhead * PX_PER_SECOND }} />
      </div>
    </div>
  );
}
