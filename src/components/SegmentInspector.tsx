import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";
import type { Asset, Segment, Transform } from "../types";

interface Props {
  segment: Segment | null;
  asset: Asset | null;
  effectiveTransform: Transform | null;
  effectiveVolume: number | null;
  projectWidth: number;
  projectHeight: number;
  currentLocalTime: number | null;
  selectedKeyframeId: string | null;
  onSeek: (time: number) => void;
  onChangeTransform: (id: string, patch: Partial<Transform>) => void;
  onChangeVolume: (id: string, volume: number) => void;
  onSplitAudio: (id: string) => void;
  onChangeDuration: (id: string, outPoint: number) => void;
  onChangeStart: (id: string, start: number) => void;
  onSetAspectLock: (id: string, locked: boolean) => void;
  onSetScaleAxis: (id: string, axis: "width" | "height", checked: boolean) => void;
  onApplyScaleToCanvas: (id: string) => void;
  onAddKeyframe: () => void;
  onSelectKeyframe: (keyframeId: string | null) => void;
  onChangeKeyframeTime: (keyframeId: string, time: number) => void;
  onDeleteKeyframe: (keyframeId: string) => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="inspector-section">
      <div className="inspector-section-title">{title}</div>
      <div className="inspector-row">{children}</div>
    </div>
  );
}

export function SegmentInspector({
  segment,
  asset,
  effectiveTransform,
  effectiveVolume,
  projectWidth,
  projectHeight,
  currentLocalTime,
  selectedKeyframeId,
  onSeek,
  onChangeTransform,
  onChangeVolume,
  onSplitAudio,
  onChangeDuration,
  onChangeStart,
  onSetAspectLock,
  onSetScaleAxis,
  onApplyScaleToCanvas,
  onAddKeyframe,
  onSelectKeyframe,
  onChangeKeyframeTime,
  onDeleteKeyframe,
  onClose,
}: Props) {
  const [scaleOpen, setScaleOpen] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);

  if (!segment) return null;

  const hasVisual = segment.kind === "video" || segment.kind === "image";
  const hasAudio = segment.kind === "video" || segment.kind === "audio";
  const hasNaturalSize = Boolean(asset?.width && asset?.height);
  const duration = segment.outPoint - segment.inPoint;

  const sortedKeyframes = [...segment.keyframes].sort((a, b) => a.time - b.time);
  const activeKeyframe = selectedKeyframeId ? (sortedKeyframes.find((k) => k.id === selectedKeyframeId) ?? null) : null;
  const effective = effectiveTransform ?? segment.transform;
  const effectiveVol = effectiveVolume ?? segment.volume;

  function numberField(label: string, value: number, onSet: (v: number) => void, step = 1) {
    return (
      <label className="inspector-field">
        <span>{label}</span>
        <input
          type="number"
          step={step}
          value={Math.round(value * 100) / 100}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (!Number.isNaN(raw)) onSet(raw);
          }}
        />
      </label>
    );
  }

  function setTransform(patch: Partial<Transform>) {
    onChangeTransform(segment!.id, patch);
  }

  function timeFromPointer(clientX: number): number {
    const el = timelineRef.current;
    if (!el || duration <= 0) return segment!.start;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return segment!.start + fraction * duration;
  }

  function handleTimelinePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    onSelectKeyframe(null);
    onSeek(timeFromPointer(e.clientX));
    scrubbingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleTimelinePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (scrubbingRef.current) onSeek(timeFromPointer(e.clientX));
  }

  function handleTimelinePointerUp() {
    scrubbingRef.current = false;
  }

  return (
    <div className="segment-inspector">
      <div className="segment-inspector-header">
        <button className="segment-inspector-back" onClick={onClose} title="Voltar para a lista de segmentos">
          ←
        </button>
        <span className="inspector-title">{asset?.name ?? "Segmento"}</span>
      </div>

      <Section title="Início e duração">
        {numberField("Início (s)", segment.start, (v) => onChangeStart(segment.id, v), 0.1)}
        {numberField("Duração (s)", duration, (v) => onChangeDuration(segment.id, segment.inPoint + Math.max(0.1, v)), 0.1)}
      </Section>

      {(hasVisual || hasAudio) && (
        <div className="inspector-section">
          <div className="inspector-section-title">Keyframes</div>
          <div
            ref={timelineRef}
            className="keyframe-timeline"
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            title="Arraste para navegar; clique num losango para editar aquele keyframe"
          >
            {currentLocalTime != null && duration > 0 && (
              <div
                className="keyframe-timeline-playhead"
                style={{ left: `${Math.min(Math.max((currentLocalTime / duration) * 100, 0), 100)}%` }}
              />
            )}
            {sortedKeyframes.map((k) => (
              <button
                key={k.id}
                className={`keyframe-marker${k.id === selectedKeyframeId ? " selected" : ""}`}
                style={{ left: `${duration > 0 ? Math.min(Math.max((k.time / duration) * 100, 0), 100) : 0}%` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectKeyframe(k.id);
                }}
                title={`t = ${k.time.toFixed(2)}s`}
              />
            ))}
          </div>
          <div className="inspector-row">
            <button
              className="inspector-add-keyframe"
              disabled={currentLocalTime == null}
              onClick={onAddKeyframe}
              title="Adiciona um keyframe no instante atual do segmento"
            >
              + Keyframe{currentLocalTime != null ? ` (${currentLocalTime.toFixed(2)}s)` : ""}
            </button>
            {activeKeyframe && (
              <>
                {numberField("Tempo do keyframe (s)", activeKeyframe.time, (v) => onChangeKeyframeTime(activeKeyframe.id, v), 0.1)}
                <button onClick={() => onDeleteKeyframe(activeKeyframe.id)}>Remover keyframe</button>
              </>
            )}
          </div>
          <span className="inspector-hint">
            {activeKeyframe
              ? `Editando o keyframe em ${activeKeyframe.time.toFixed(2)}s — as seções abaixo alteram esse ponto.`
              : "Nenhum keyframe selecionado — as seções abaixo alteram os valores base do segmento."}
          </span>
        </div>
      )}

      {hasAudio && (
        <div className="inspector-section">
          <div className="inspector-section-title">Volume</div>
          <div className="inspector-row opacity-row">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(effectiveVol * 100)}
              onChange={(e) => onChangeVolume(segment.id, Number(e.target.value) / 100)}
            />
            {numberField("Volume (%)", Math.round(effectiveVol * 100), (v) =>
              onChangeVolume(segment.id, Math.max(0, v) / 100),
            )}
          </div>
          {segment.kind === "video" && (
            <button
              className="split-audio-button"
              onClick={() => onSplitAudio(segment.id)}
              title="Move o áudio deste vídeo para uma nova camada de áudio e silencia o vídeo original"
            >
              Separar áudio em nova camada
            </button>
          )}
        </div>
      )}

      {hasVisual && (
        <>
          <div className="inspector-section">
            <div className="inspector-section-title">Tamanho</div>
            <div className="inspector-row">
              {numberField("Largura (px)", effective.width, (v) => setTransform({ width: v }))}
              {numberField("Altura (px)", effective.height, (v) => setTransform({ height: v }))}
            </div>
            <button className="inspector-collapse-toggle" onClick={() => setScaleOpen((open) => !open)}>
              {scaleOpen ? "▾" : "▸"} Escalonar e manter proporção
            </button>
            {scaleOpen && (
              <div className="inspector-row size-mode-row">
                <label
                  className="size-mode-checkbox"
                  title={hasNaturalSize ? undefined : "Dimensões originais do asset desconhecidas"}
                >
                  <input
                    type="checkbox"
                    checked={segment.sizeMode.lockAspectRatio}
                    disabled={!hasNaturalSize}
                    onChange={(e) => onSetAspectLock(segment.id, e.target.checked)}
                  />
                  <span>Manter proporção original</span>
                </label>
                <div className="scale-to-canvas">
                  <button onClick={() => onApplyScaleToCanvas(segment.id)}>Escalonar para canvas inteiro</button>
                  <div className="scale-to-canvas-axes">
                    <label className="size-mode-checkbox">
                      <input
                        type="checkbox"
                        checked={segment.sizeMode.scaleAxes.width}
                        onChange={(e) => onSetScaleAxis(segment.id, "width", e.target.checked)}
                      />
                      <span>Largura</span>
                    </label>
                    <label className="size-mode-checkbox">
                      <input
                        type="checkbox"
                        checked={segment.sizeMode.scaleAxes.height}
                        onChange={(e) => onSetScaleAxis(segment.id, "height", e.target.checked)}
                      />
                      <span>Altura</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Posição</div>
            <div className="inspector-row">
              {numberField("X (px)", effective.x, (v) => setTransform({ x: v }))}
              {numberField("Y (px)", effective.y, (v) => setTransform({ y: v }))}
            </div>
            <div className="inspector-row quick-actions">
              <button onClick={() => setTransform({ x: 0, y: 0 })}>Origem (0,0)</button>
              <button
                onClick={() =>
                  setTransform({ x: (projectWidth - effective.width) / 2, y: (projectHeight - effective.height) / 2 })
                }
              >
                Centralizar
              </button>
              <button onClick={() => setTransform({ x: (projectWidth - effective.width) / 2 })}>Centralizar horizontal</button>
              <button onClick={() => setTransform({ y: (projectHeight - effective.height) / 2 })}>Centralizar vertical</button>
            </div>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Rotação</div>
            <div className="inspector-row">{numberField("Ângulo (°)", effective.rotation, (v) => setTransform({ rotation: v }))}</div>
            <div className="inspector-row quick-actions">
              <button onClick={() => setTransform({ rotation: effective.rotation - 90 })}>-90°</button>
              <button onClick={() => setTransform({ rotation: effective.rotation - 15 })}>-15°</button>
              <button onClick={() => setTransform({ rotation: effective.rotation + 15 })}>+15°</button>
              <button onClick={() => setTransform({ rotation: effective.rotation + 90 })}>+90°</button>
            </div>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Opacidade</div>
            <div className="inspector-row opacity-row">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(effective.opacity * 100)}
                onChange={(e) => setTransform({ opacity: Number(e.target.value) / 100 })}
              />
              {numberField("Opacidade (%)", Math.round(effective.opacity * 100), (v) =>
                setTransform({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
