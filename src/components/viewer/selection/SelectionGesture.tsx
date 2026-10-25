import { useEffect, useRef, useState } from "react";
import { rasterizeGesture } from "./rasterizeGesture";
import { brushDiameter } from "./brushDiameter";
import { rectangleBetween, selectionOperation, type Point, type SelectionOperation } from "./rectangle";
import type { SelectionHandle, SelectionRegion, SelectionShape } from "./types";

export function SelectionGesture({ handle, tool, brushSize, onSelect }: {
  handle: SelectionHandle;
  tool: SelectionShape; brushSize: number;
  onSelect(region: SelectionRegion, operation: SelectionOperation): void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [diameter, setDiameter] = useState(1);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const canvas = overlay.current!.closest(".viewer-frame")!.querySelector<HTMLCanvasElement>(".viewer-canvas canvas")!;
    const previousCursor = canvas.style.cursor, previousTouchAction = canvas.style.touchAction;
    canvas.style.cursor = "crosshair"; canvas.style.touchAction = "none";
    let bounds = handle.selection.bounds(null);
    const refreshBounds = () => { bounds = handle.selection.bounds(null); };
    handle.space.on("change", refreshBounds);
    let brushPixels = 1;
    function updateBrush(event: PointerEvent) {
      if (tool !== "brush" || drag || !bounds) return;
      const rect = canvas.getBoundingClientRect();
      const panel = handle.viewports.at((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      if (panel) { brushPixels = brushDiameter(bounds, panel.camera, brushSize); setDiameter(brushPixels); }
    }
    let drag: { id: number; points: Point[]; rect: { left: number; top: number; width: number; height: number } } | null = null;
    function point(event: PointerEvent): Point {
      const bounds = canvas.getBoundingClientRect();
      const r = drag?.rect ?? { left: 0, top: 0, width: bounds.width, height: bounds.height };
      return { x: Math.max(r.left, Math.min(r.left + r.width, event.clientX - bounds.left)),
        y: Math.max(r.top, Math.min(r.top + r.height, event.clientY - bounds.top)) };
    }
    function reset() {
      const id = drag?.id;
      drag = null; setPoints([]);
      if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    function down(event: PointerEvent) {
      // Leave navigation gestures to PlayCanvas's own canvas input handlers.
      if (!event.isPrimary || event.button !== 0 || event.altKey || drag) return;
      updateBrush(event);
      event.preventDefault(); event.stopImmediatePropagation();
      canvas.setPointerCapture(event.pointerId);
      const bounds = canvas.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
      const panel = handle.viewports.at((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)!;
      handle.viewports.activate(panel);
      const r = panel.camera.rect;
      drag = { id: event.pointerId, points: [point(event)], rect: {
        left: Math.round(r.x * bounds.width), top: Math.round((1 - r.y - r.w) * bounds.height),
        width: Math.round(r.z * bounds.width), height: Math.round(r.w * bounds.height) } };
      setPoints([...drag.points]);
    }
    function move(event: PointerEvent) {
      updateBrush(event);
      const next = point(event); setCursor(next);
      if (drag?.id !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag.points.push(next); setPoints([...drag.points]);
    }
    function up(event: PointerEvent) {
      if (drag?.id !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const path = [...drag.points, point(event)];
      const r = drag.rect;
      const region = rasterizeGesture(tool, path.map(p => ({ x: p.x - r.left, y: p.y - r.top })),
        r.width, r.height, brushPixels);
      reset();
      onSelect(region, selectionOperation(event));
    }
    function wheel(event: WheelEvent) {
      if (drag) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    function leave() { setCursor(null); }
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move, true);
    canvas.addEventListener("pointerup", up, true);
    canvas.addEventListener("pointercancel", reset, true);
    canvas.addEventListener("lostpointercapture", reset);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", up, true);
      canvas.removeEventListener("pointercancel", reset, true);
      canvas.removeEventListener("lostpointercapture", reset);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel, true);
      reset();
      handle.space.off("change", refreshBounds);
      canvas.style.cursor = previousCursor; canvas.style.touchAction = previousTouchAction;
    };
  }, [handle, tool, brushSize, onSelect]);
  const area = points.length ? rectangleBetween(points[0]!, points.at(-1)!) : null;
  return <div ref={overlay} className="selection-overlay" aria-label={`${tool} selection area`}>
    <svg className="selection-drawing" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
      {tool === "rectangle" && area && <rect x={area.start.x} y={area.start.y} width={area.end.x - area.start.x} height={area.end.y - area.start.y} />}
      {tool === "lasso" && <polygon points={points.map(p => `${p.x},${p.y}`).join(" ")} />}
      {tool === "brush" && <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} style={{ strokeWidth: diameter, fill: "none", strokeLinecap: "round", strokeLinejoin: "round", opacity: .35 }} />}
    </svg>
    {tool === "brush" && cursor && <span className="selection-brush-cursor" style={{ left: cursor.x, top: cursor.y, width: diameter, height: diameter }} />}
  </div>;
}
