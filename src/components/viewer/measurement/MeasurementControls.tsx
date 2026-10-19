import { useEffect, useState } from "react";
import type { SelectionHandle } from "../selection/types";
import { focusSelection } from "../selection/focusSelection";
import { formatDistance, Measurement } from "./Measurement";
import { MeasurementVisuals } from "./MeasurementVisuals";
import { defaultMeasurementStyle } from "./MeasurementRenderer";
import { useSurfacePick } from "../picking/useSurfacePick";

export function MeasurementControls({ handle, measurement, active, onChange }: {
  handle: SelectionHandle; measurement: Measurement; active: boolean; onChange(): void;
}) {
  const [style, setStyle] = useState(defaultMeasurementStyle);
  const [, refresh] = useState(0);
  const redraw = () => { refresh(value => value + 1); onChange(); };
  const { busy, message, clearMessage } = useSurfacePick({ handle, active,
    acceptsClick: shift => measurement.points.length < 2 || shift,
    onPick: (point, shift) => { measurement.add(handle.space.toLocal(point), shift); redraw(); }
  });
  useEffect(() => {
    if (!active) return;
    const frame = (handle.app.graphicsDevice.canvas as HTMLCanvasElement).closest(".viewer-frame")!;
    function keyDown(event: Event) {
      const key = event as KeyboardEvent;
      if (key.repeat || key.altKey || (key.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const undo = (key.metaKey || key.ctrlKey) && key.key.toLowerCase() === "z";
      const focus = !key.metaKey && !key.ctrlKey && key.key.toLowerCase() === "f";
      if (!undo && !focus) return;
      key.preventDefault(); key.stopPropagation();
      if (busy) return;
      if (undo) { if (key.shiftKey) measurement.redo(); else measurement.undo(); redraw(); }
      else {
        const local = measurement.bounds();
        const bounds = local ? handle.space.worldBounds(local) : handle.selection.bounds();
        if (bounds) focusSelection(bounds, handle.camera());
      }
    }
    frame.addEventListener("keydown", keyDown);
    return () => { frame.removeEventListener("keydown", keyDown); };
  }, [handle, active, measurement, busy]);
  return <>
    {measurement.records.length > 0 && <MeasurementVisuals handle={handle} segments={measurement.visibleSegments} style={style} />}
    {active && <div className="selection-actions measurement-actions" role="group" aria-label="Measurement">
      <span role="status">{busy ? "Picking surface…" : message ?? (measurement.points.length === 0 ? "Click the first surface point" : measurement.points.length === 1 ? "Click the second surface point" : "Shift-click to add another measurement")}</span>
      {measurement.distance !== null && <output aria-label="Measured distance">{formatDistance(measurement.distance)}</output>}
      <label>Line width<input type="range" min="1" max="8" step="1" value={style.lineWidth}
        onChange={event => setStyle(current => ({ ...current, lineWidth: Number(event.target.value) }))} /></label>
      <label>Font size<input type="range" min="10" max="28" step="1" value={style.fontSize}
        onChange={event => setStyle(current => ({ ...current, fontSize: Number(event.target.value) }))} /></label>
      <button disabled={busy || measurement.points.length === 0} onClick={() => { measurement.clear(); clearMessage(); redraw(); }}>Clear measurements</button>
    </div>}
  </>;
}
