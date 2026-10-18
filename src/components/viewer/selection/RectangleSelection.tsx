import { useRef, useState, type PointerEvent } from "react";
import { rectangleBetween, selectionOperation, type Point, type Rectangle, type SelectionOperation } from "./rectangle";

// Adapted from SuperSplat's rect-selection.ts; see public/licenses/supersplat.txt.
export function RectangleSelection({ onSelect }: {
  onSelect(rectangle: Rectangle, operation: SelectionOperation): void;
}) {
  const drag = useRef<{ id: number; start: Point } | null>(null);
  const [rectangle, setRectangle] = useState<Rectangle | null>(null);

  function point(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    };
  }

  return (
    <div className="selection-overlay" aria-label="Rectangle selection area"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, start: point(event) };
        setRectangle(null);
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) setRectangle(rectangleBetween(drag.current.start, point(event)));
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        const area = rectangleBetween(drag.current.start, point(event));
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setRectangle(null);
        if (area.start.x !== area.end.x && area.start.y !== area.end.y) onSelect(area, selectionOperation(event));
      }}
      onPointerCancel={() => { drag.current = null; setRectangle(null); }}
      onLostPointerCapture={() => { drag.current = null; setRectangle(null); }}
      onContextMenu={event => event.preventDefault()}
    >
      {rectangle && <div className="selection-rectangle" style={{
        left: `${rectangle.start.x * 100}%`, top: `${rectangle.start.y * 100}%`,
        width: `${(rectangle.end.x - rectangle.start.x) * 100}%`, height: `${(rectangle.end.y - rectangle.start.y) * 100}%`
      }} />}
    </div>
  );
}
