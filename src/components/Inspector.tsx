import type { Clip, Transform } from "../types";

interface Props {
  clip: Clip | null;
  onChange: (id: string, patch: Partial<Transform>) => void;
}

export function Inspector({ clip, onChange }: Props) {
  if (!clip) return null;

  function field(label: string, key: keyof Transform, value: number, step = 1) {
    return (
      <label className="inspector-field">
        <span>{label}</span>
        <input
          type="number"
          step={step}
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

  return (
    <div className="inspector">
      <span className="inspector-title">{clip.sourcePath.split(/[\\/]/).pop()}</span>
      {field("X (px)", "x", clip.transform.x)}
      {field("Y (px)", "y", clip.transform.y)}
      {field("Largura (px)", "width", clip.transform.width)}
      {field("Altura (px)", "height", clip.transform.height)}
      {field("Opacidade (%)", "opacity", clip.transform.opacity)}
    </div>
  );
}
