import type { Clip, Transform } from "../types";

interface Props {
  clip: Clip | null;
  currentLocalTime: number | null;
  onChange: (id: string, patch: Partial<Transform>) => void;
  onAddKeyframe: () => void;
  onUpdateKeyframe: (keyframeId: string, patch: { time?: number; x?: number; y?: number }) => void;
  onDeleteKeyframe: (keyframeId: string) => void;
}

export function Inspector({ clip, currentLocalTime, onChange, onAddKeyframe, onUpdateKeyframe, onDeleteKeyframe }: Props) {
  if (!clip) return null;

  function transformField(label: string, key: keyof Transform, value: number) {
    return (
      <label className="inspector-field">
        <span>{label}</span>
        <input
          type="number"
          step={1}
          value={Math.round(value * (key === "opacity" ? 100 : 1) * 100) / 100}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (Number.isNaN(raw)) return;
            onChange(clip!.id, { [key]: key === "opacity" ? raw / 100 : raw } as Partial<Transform>);
          }}
        />
      </label>
    );
  }

  const hasKeyframes = clip.positionKeyframes.length > 0;
  const sortedKeyframes = [...clip.positionKeyframes].sort((a, b) => a.time - b.time);

  return (
    <div className="inspector">
      <div className="inspector-row">
        <span className="inspector-title">{clip.sourcePath.split(/[\\/]/).pop()}</span>
        {!hasKeyframes && transformField("X (px)", "x", clip.transform.x)}
        {!hasKeyframes && transformField("Y (px)", "y", clip.transform.y)}
        {transformField("Largura (px)", "width", clip.transform.width)}
        {transformField("Altura (px)", "height", clip.transform.height)}
        {transformField("Opacidade (%)", "opacity", clip.transform.opacity)}
        <button
          className="inspector-add-keyframe"
          disabled={currentLocalTime == null}
          onClick={onAddKeyframe}
          title="Adiciona um ponto de posição no instante atual do clipe"
        >
          + Keyframe de posição{currentLocalTime != null ? ` (${currentLocalTime.toFixed(2)}s)` : ""}
        </button>
      </div>
      {hasKeyframes && (
        <div className="inspector-row keyframe-list">
          {sortedKeyframes.map((k) => (
            <div key={k.id} className="keyframe-item">
              <label>
                <span>t</span>
                <input
                  type="number"
                  step={0.1}
                  value={Math.round(k.time * 100) / 100}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isNaN(raw)) onUpdateKeyframe(k.id, { time: raw });
                  }}
                />
              </label>
              <label>
                <span>X</span>
                <input
                  type="number"
                  step={1}
                  value={Math.round(k.x)}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isNaN(raw)) onUpdateKeyframe(k.id, { x: raw });
                  }}
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number"
                  step={1}
                  value={Math.round(k.y)}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isNaN(raw)) onUpdateKeyframe(k.id, { y: raw });
                  }}
                />
              </label>
              <button title="Remover keyframe" onClick={() => onDeleteKeyframe(k.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
