import type { Asset } from "../types";

export const ASSET_DRAG_MIME = "application/x-video-editor-asset";

interface Props {
  assets: Asset[];
  onImport: () => void;
}

function kindIcon(kind: Asset["kind"]): string {
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  return "🖼";
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AssetsPanel({ assets, onImport }: Props) {
  return (
    <div className="assets-panel">
      <div className="assets-panel-header">
        <span>Assets</span>
        <button onClick={onImport}>Importar</button>
      </div>
      <div className="assets-panel-list">
        {assets.length === 0 && <div className="assets-panel-empty">Nenhum arquivo importado ainda.</div>}
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="asset-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={asset.sourcePath}
          >
            <span className="asset-item-icon">{kindIcon(asset.kind)}</span>
            <span className="asset-item-name">{asset.name}</span>
            <span className="asset-item-duration">{formatDuration(asset.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
