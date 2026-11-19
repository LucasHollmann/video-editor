import { useState } from "react";
import { RESOLUTION_PRESETS } from "../types";

interface Props {
  onCreate: (width: number, height: number) => void;
}

export function ProjectSetup({ onCreate }: Props) {
  const [width, setWidth] = useState(RESOLUTION_PRESETS[0].width);
  const [height, setHeight] = useState(RESOLUTION_PRESETS[0].height);

  return (
    <div className="project-setup">
      <div className="project-setup-card">
        <h1>Novo projeto</h1>
        <p>Defina as dimensões do vídeo final antes de começar.</p>

        <div className="project-setup-presets">
          {RESOLUTION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={width === preset.width && height === preset.height ? "selected" : ""}
              onClick={() => {
                setWidth(preset.width);
                setHeight(preset.height);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="project-setup-custom">
          <label>
            <span>Largura (px)</span>
            <input type="number" min={2} value={width} onChange={(e) => setWidth(Number(e.target.value) || 0)} />
          </label>
          <label>
            <span>Altura (px)</span>
            <input type="number" min={2} value={height} onChange={(e) => setHeight(Number(e.target.value) || 0)} />
          </label>
        </div>

        <button
          className="project-setup-confirm"
          disabled={width < 2 || height < 2}
          onClick={() => onCreate(Math.round(width), Math.round(height))}
        >
          Criar projeto
        </button>
      </div>
    </div>
  );
}
