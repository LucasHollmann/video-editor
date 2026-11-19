import { type PointerEvent as ReactPointerEvent, useRef } from "react";

interface Props {
  // "horizontal" drags left/right to resize a width; "vertical" drags up/down to
  // resize a height. `edge` says which side of the panel the handle sits on.
  axis: "horizontal" | "vertical";
  edge: "left" | "right" | "top";
  onDrag: (delta: number) => void;
}

export function ResizeHandle({ axis, edge, onDrag }: Props) {
  const lastRef = useRef(0);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    lastRef.current = axis === "horizontal" ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return;
    const current = axis === "horizontal" ? e.clientX : e.clientY;
    const delta = current - lastRef.current;
    lastRef.current = current;
    if (delta !== 0) onDrag(delta);
  }

  return (
    <div
      className={`resize-handle resize-handle-${axis} resize-handle-${edge}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    />
  );
}
