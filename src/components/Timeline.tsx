import { type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, useRef } from "react";
import {
  type Asset,
  type Segment,
  type Track,
  findSegmentAtTime,
  segmentDuration,
  totalDuration,
} from "../types";
import { ASSET_DRAG_MIME } from "./AssetsPanel";
import { ResizeHandle } from "./ResizeHandle";

interface Props {
  tracks: Track[];
  assets: Asset[];
  playhead: number;
  height: number;
  onResizeHeight: (delta: number) => void;
  selectedSegmentId: string | null;
  selectedTrackId: string | null;
  onSeek: (time: number) => void;
  onSelectSegment: (id: string | null, trackId: string | null) => void;
  onSelectTrack: (id: string) => void;
  onTrim: (id: string, patch: { inPoint?: number; outPoint?: number }) => void;
  onMoveSegment: (id: string, trackId: string, start: number) => void;
  onDropAsset: (assetId: string, trackId: string, start: number) => void;
  onMoveTrackUp: (id: string) => void;
  onMoveTrackDown: (id: string) => void;
  onDeleteTrack: (id: string) => void;
  onAddTrack: () => void;
  isPlaying: boolean;
  canSplit: boolean;
  canDelete: boolean;
  onPlayPause: () => void;
  onSplit: () => void;
  onDelete: () => void;
}

const PX_PER_SECOND = 80;
const MIN_TRACK_WIDTH = 640;
const HEADER_WIDTH = 140;

type Drag =
  | { type: "scrub" }
  | { type: "trim"; segmentId: string; edge: "in" | "out"; startX: number; startIn: number; startOut: number }
  | { type: "move"; segmentId: string; startX: number; startStart: number; currentTrackId: string };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function kindIcon(kind: Asset["kind"]): string {
  if (kind === "video") return "🎬 ";
  if (kind === "audio") return "🎵 ";
  return "🖼 ";
}

export function Timeline({
  tracks,
  assets,
  playhead,
  height,
  onResizeHeight,
  selectedSegmentId,
  selectedTrackId,
  onSeek,
  onSelectSegment,
  onSelectTrack,
  onTrim,
  onMoveSegment,
  onDropAsset,
  onMoveTrackUp,
  onMoveTrackDown,
  onDeleteTrack,
  onAddTrack,
  isPlaying,
  canSplit,
  canDelete,
  onPlayPause,
  onSplit,
  onDelete,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const duration = Math.max(totalDuration(tracks), 1);
  const widthPx = Math.max(duration * PX_PER_SECOND, MIN_TRACK_WIDTH);

  function xToTime(clientX: number) {
    const rect = gridRef.current!.getBoundingClientRect();
    const x = clientX - rect.left - HEADER_WIDTH + gridRef.current!.scrollLeft;
    return Math.max(0, x / PX_PER_SECOND);
  }

  function trackIdAtY(clientY: number): string | null {
    for (const [trackId, el] of rowRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return trackId;
    }
    return null;
  }

  function handleRowPointerDown(e: ReactPointerEvent<HTMLDivElement>, track: Track) {
    const time = xToTime(e.clientX);
    onSeek(time);
    const segment = findSegmentAtTime(track.segments, time);
    onSelectSegment(segment ? segment.id : null, track.id);
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

  function handleRulerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    onSeek(xToTime(e.clientX));
    dragRef.current = { type: "scrub" };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleRowDragOver(e: ReactDragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes(ASSET_DRAG_MIME)) e.preventDefault();
  }

  function handleRowDrop(e: ReactDragEvent<HTMLDivElement>, track: Track) {
    e.preventDefault();
    const assetId = e.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!assetId) return;
    onDropAsset(assetId, track.id, xToTime(e.clientX));
  }

  function handleSegmentPointerDown(e: ReactPointerEvent<HTMLDivElement>, segment: Segment, track: Track) {
    e.stopPropagation();
    onSelectSegment(segment.id, track.id);
    onSelectTrack(track.id);
    dragRef.current = { type: "move", segmentId: segment.id, startX: e.clientX, startStart: segment.start, currentTrackId: track.id };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleSegmentPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.type !== "move") return;
    e.stopPropagation();
    const deltaSeconds = (e.clientX - drag.startX) / PX_PER_SECOND;
    const candidateStart = Math.max(0, drag.startStart + deltaSeconds);
    const hoveredTrackId = trackIdAtY(e.clientY) ?? drag.currentTrackId;
    drag.currentTrackId = hoveredTrackId;
    onMoveSegment(drag.segmentId, hoveredTrackId, candidateStart);
  }

  function handleSegmentPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    dragRef.current = null;
  }

  function handleHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>, segment: Segment, edge: "in" | "out") {
    e.stopPropagation();
    dragRef.current = {
      type: "trim",
      segmentId: segment.id,
      edge,
      startX: e.clientX,
      startIn: segment.inPoint,
      startOut: segment.outPoint,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleHandlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.type !== "trim") return;
    e.stopPropagation();
    const deltaSeconds = (e.clientX - drag.startX) / PX_PER_SECOND;
    if (drag.edge === "in") onTrim(drag.segmentId, { inPoint: drag.startIn + deltaSeconds });
    else onTrim(drag.segmentId, { outPoint: drag.startOut + deltaSeconds });
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
    <div className="timeline" style={{ height }}>
      <ResizeHandle axis="vertical" edge="top" onDrag={(delta) => onResizeHeight(-delta)} />
      <div className="timeline-toolbar">
        <button title={isPlaying ? "Pausar (Espaço)" : "Reproduzir (Espaço)"} onClick={onPlayPause}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button title="Cortar (S)" disabled={!canSplit} onClick={onSplit}>
          ✂
        </button>
        <button title="Excluir segmento (Del)" disabled={!canDelete} onClick={onDelete}>
          🗑
        </button>
      </div>
      <div ref={gridRef} className="timeline-grid">
        <div className="timeline-row timeline-ruler-row">
          <div className="track-header sticky-col" />
          <div
            className="timeline-ruler"
            style={{ width: widthPx }}
            onPointerDown={handleRulerPointerDown}
            onPointerMove={handleRowPointerMove}
            onPointerUp={handleRowPointerUp}
          >
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
              ref={(el) => {
                if (el) rowRefs.current.set(track.id, el);
                else rowRefs.current.delete(track.id);
              }}
              className={`timeline-track${track.id === selectedTrackId ? " selected" : ""}`}
              style={{ width: widthPx }}
              onPointerDown={(e) => handleRowPointerDown(e, track)}
              onPointerMove={handleRowPointerMove}
              onPointerUp={handleRowPointerUp}
              onDragOver={handleRowDragOver}
              onDrop={(e) => handleRowDrop(e, track)}
            >
              {track.segments.map((segment) => {
                const asset = assets.find((a) => a.id === segment.assetId);
                const left = segment.start * PX_PER_SECOND;
                const width = Math.max(segmentDuration(segment) * PX_PER_SECOND, 4);
                const selected = segment.id === selectedSegmentId;
                return (
                  <div
                    key={segment.id}
                    className={`clip-block clip-${segment.kind}${selected ? " selected" : ""}`}
                    style={{ left, width }}
                    onPointerDown={(e) => handleSegmentPointerDown(e, segment, track)}
                    onPointerMove={handleSegmentPointerMove}
                    onPointerUp={handleSegmentPointerUp}
                  >
                    <div
                      className="trim-handle trim-handle-left"
                      onPointerDown={(e) => handleHandlePointerDown(e, segment, "in")}
                      onPointerMove={handleHandlePointerMove}
                      onPointerUp={handleHandlePointerUp}
                    />
                    <span className="clip-label">
                      {kindIcon(segment.kind)}
                      {asset?.name ?? segment.assetId}
                    </span>
                    <div
                      className="trim-handle trim-handle-right"
                      onPointerDown={(e) => handleHandlePointerDown(e, segment, "out")}
                      onPointerMove={handleHandlePointerMove}
                      onPointerUp={handleHandlePointerUp}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="timeline-row timeline-add-track-row">
          <div className="track-header sticky-col add-track-cell">
            <button className="add-track-button" title="Nova camada" onClick={onAddTrack}>
              +
            </button>
          </div>
        </div>
        <div className="playhead" style={{ left: HEADER_WIDTH + playhead * PX_PER_SECOND }} />
      </div>
    </div>
  );
}
