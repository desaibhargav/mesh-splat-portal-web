import { useRef, useState, type PointerEvent } from "react";
import { rectangleBetween, selectionOperation, type Point, type SelectionOperation } from "./rectangle";
import type { SelectionRegion, SelectionTool } from "./types";

export function SelectionGesture({ tool, brushSize, onSelect }: {
  tool: Exclude<SelectionTool, "navigate">; brushSize: number;
  onSelect(region: SelectionRegion, operation: SelectionOperation): void;
}) {
  const drag = useRef<{ id: number; points: Point[] } | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  function point(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) };
  }
  function reset() { drag.current = null; setPoints([]); }
  const area = points.length ? rectangleBetween(points[0]!, points.at(-1)!) : null;
  return <div className="selection-overlay" aria-label={`${tool} selection area`}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const bounds = event.currentTarget.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
      drag.current = { id: event.pointerId, points: [point(event)] };
      setPoints([...drag.current.points]);
    }}
    onPointerMove={event => {
      const next = point(event);
      setCursor(next);
      if (drag.current?.id !== event.pointerId) return;
      drag.current.points.push(next);
      setPoints([...drag.current.points]);
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      const path = [...drag.current.points, point(event)];
      const canvas = document.createElement("canvas");
      const bounds = event.currentTarget.getBoundingClientRect();
      canvas.width = Math.ceil(bounds.width); canvas.height = Math.ceil(bounds.height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white"; context.strokeStyle = "white";
      if (tool === "rectangle") {
        const rectangle = rectangleBetween(path[0]!, path.at(-1)!);
        context.fillRect(rectangle.start.x, rectangle.start.y, rectangle.end.x - rectangle.start.x, rectangle.end.y - rectangle.start.y);
      } else {
        context.beginPath(); context.moveTo(path[0]!.x, path[0]!.y);
        for (const p of path.slice(1)) context.lineTo(p.x, p.y);
        if (tool === "lasso") { context.closePath(); context.fill("evenodd"); }
        else { context.lineWidth = brushSize; context.lineCap = "round"; context.lineJoin = "round"; context.stroke(); }
      }
      reset();
      event.currentTarget.releasePointerCapture(event.pointerId);
      onSelect({ pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }, selectionOperation(event));
    }}
    onPointerCancel={reset} onLostPointerCapture={reset} onPointerLeave={() => setCursor(null)}
    onContextMenu={event => event.preventDefault()}>
    <svg className="selection-drawing" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
      {tool === "rectangle" && area && <rect x={area.start.x} y={area.start.y} width={area.end.x - area.start.x} height={area.end.y - area.start.y} />}
      {tool === "lasso" && <polygon points={points.map(p => `${p.x},${p.y}`).join(" ")} />}
      {tool === "brush" && <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} style={{ strokeWidth: brushSize, fill: "none", strokeLinecap: "round", strokeLinejoin: "round", opacity: .35 }} />}
    </svg>
    {tool === "brush" && cursor && <span className="selection-brush-cursor" style={{ left: cursor.x, top: cursor.y, width: brushSize, height: brushSize }} />}
  </div>;
}
