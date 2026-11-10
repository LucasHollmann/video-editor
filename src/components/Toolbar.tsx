interface Props {
  isPlaying: boolean;
  isExporting: boolean;
  canSplit: boolean;
  canDelete: boolean;
  canExport: boolean;
  currentTime: number;
  totalDuration: number;
  onImport: () => void;
  onPlayPause: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onExport: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Toolbar({
  isPlaying,
  isExporting,
  canSplit,
  canDelete,
  canExport,
  currentTime,
  totalDuration,
  onImport,
  onPlayPause,
  onSplit,
  onDelete,
  onExport,
}: Props) {
  return (
    <div className="toolbar">
      <button onClick={onImport}>Importar vídeo</button>
      <button onClick={onPlayPause} disabled={totalDuration === 0}>
        {isPlaying ? "Pausar" : "Reproduzir"}
      </button>
      <button onClick={onSplit} disabled={!canSplit}>
        Cortar (S)
      </button>
      <button onClick={onDelete} disabled={!canDelete}>
        Excluir clipe (Del)
      </button>
      <span className="toolbar-time">
        {formatTime(currentTime)} / {formatTime(totalDuration)}
      </span>
      <button className="toolbar-export" onClick={onExport} disabled={!canExport || isExporting}>
        {isExporting ? "Exportando..." : "Exportar"}
      </button>
    </div>
  );
}
