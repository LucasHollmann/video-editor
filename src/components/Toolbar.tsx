interface Props {
  isExporting: boolean;
  canExport: boolean;
  currentTime: number;
  totalDuration: number;
  onExport: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Toolbar({ isExporting, canExport, currentTime, totalDuration, onExport }: Props) {
  return (
    <div className="toolbar">
      <span className="toolbar-time">
        {formatTime(currentTime)} / {formatTime(totalDuration)}
      </span>
      <button className="toolbar-export" onClick={onExport} disabled={!canExport || isExporting}>
        {isExporting ? "Exportando..." : "Exportar"}
      </button>
    </div>
  );
}
