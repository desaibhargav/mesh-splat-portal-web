import { useEffect, useMemo, useState } from "react";
import type { ArtifactType } from "../../../api/artifacts";
import type { SelectionHandle } from "../selection/types";
import { focusSelection } from "../selection/focusSelection";
import { formatDistance, Measurement } from "./Measurement";
import { MeasurementVisuals } from "./MeasurementVisuals";
import { useSurfacePick } from "../picking/useSurfacePick";

export function MeasurementControls({ handle, active, assetType, onActiveChange }: {
  handle: SelectionHandle; active: boolean; assetType: ArtifactType; onActiveChange(active: boolean): void;
}) {
  const measurement = useMemo(() => new Measurement(), [handle]);
  const [, refresh] = useState(0);
  const redraw = () => refresh(value => value + 1);
  const { busy, message, clearMessage } = useSurfacePick({ handle, active, onActiveChange,
    acceptsClick: shift => measurement.points.length < 2 || shift,
    onPick: (point, shift) => { measurement.add(point, shift); redraw(); }
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
        const bounds = measurement.bounds() ?? handle.selection.bounds();
        if (bounds) focusSelection(bounds, handle.camera());
      }
    }
    frame.addEventListener("keydown", keyDown);
    return () => { frame.removeEventListener("keydown", keyDown); };
  }, [handle, active, measurement, busy]);
  return <>
    {measurement.segments.length > 0 && <MeasurementVisuals handle={handle} segments={measurement.segments} />}
    {active && <div className="selection-actions measurement-actions" role="group" aria-label="Measurement">
      <span role="status">{busy ? "Picking surface…" : message ?? (measurement.points.length === 0 ? "Click the first surface point" : measurement.points.length === 1 ? "Click the second surface point" : "Shift-click to add another measurement")}</span>
      {measurement.distance !== null && <output aria-label="Measured distance">{formatDistance(measurement.distance)} model units</output>}
      <small>{assetType === "mesh" ? "GLB convention: meters. Physical scale unverified." : "This splat has no declared physical units."}</small>
      <button disabled={busy || measurement.points.length === 0} onClick={() => { measurement.clear(); clearMessage(); redraw(); }}>Clear measurements</button>
    </div>}
  </>;
}
