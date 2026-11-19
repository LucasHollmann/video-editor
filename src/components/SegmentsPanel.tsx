import type { Asset, Track } from "../types";

interface Props {
  tracks: Track[];
  assets: Asset[];
  selectedSegmentId: string | null;
  onSelect: (id: string, trackId: string) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function kindIcon(kind: Asset["kind"]): string {
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  return "🖼";
}

export function SegmentsPanel({ tracks, assets, selectedSegmentId, onSelect }: Props) {
  const rows = tracks.flatMap((track) =>
    track.segments.map((segment) => ({
      segment,
      track,
      asset: assets.find((a) => a.id === segment.assetId) ?? null,
    })),
  );
  rows.sort((a, b) => a.segment.start - b.segment.start);

  return (
    <div className="segments-panel">
      <div className="segments-panel-header">Segmentos</div>
      <div className="segments-panel-list">
        {rows.length === 0 && <div className="segments-panel-empty">Nenhum segmento na timeline ainda.</div>}
        {rows.map(({ segment, track, asset }) => (
          <div
            key={segment.id}
            className={`segment-row${segment.id === selectedSegmentId ? " selected" : ""}`}
            onClick={() => onSelect(segment.id, track.id)}
          >
            <span className="segment-row-icon">{kindIcon(segment.kind)}</span>
            <span className="segment-row-name">{asset?.name ?? segment.assetId}</span>
            <span className="segment-row-track">{track.name}</span>
            <span className="segment-row-time">
              {formatTime(segment.start)} – {formatTime(segment.start + (segment.outPoint - segment.inPoint))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
