import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactType } from "../../../api/artifacts";
import type { SelectionHandle } from "../selection/types";
import { focusSelection } from "../selection/focusSelection";
import { formatDistance, Measurement } from "./Measurement";
import { MeasurementOverlay } from "./MeasurementOverlay";
import { SurfacePicker } from "./SurfacePicker";

export function MeasurementControls({ handle, active, assetType, onActiveChange }: {
  handle: SelectionHandle; active: boolean; assetType: ArtifactType; onActiveChange(active: boolean): void;
}) {
  const measurement = useMemo(() => new Measurement(), [handle]);
  const picker = useRef<SurfacePicker | null>(null);
  const pending = useRef(false);
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const redraw = () => refresh(value => value + 1);
  useEffect(() => {
    const surface = new SurfacePicker(handle.app); picker.current = surface;
    return () => { surface.destroy(); picker.current = null; };
  }, [handle]);
  useEffect(() => {
    if (!active) return;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    const frame = canvas.closest(".viewer-frame")!;
    let down: { id: number; x: number; y: number; u: number; v: number } | null = null;
    let cancelled = false;
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    function reset() {
      const id = down?.id; down = null; onActiveChange(false);
      if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    function pointerDown(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || event.altKey || down) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const bounds = canvas.getBoundingClientRect();
      down = { id: event.pointerId, x: event.clientX, y: event.clientY,
        u: (event.clientX - bounds.left) / bounds.width, v: (event.clientY - bounds.top) / bounds.height };
      canvas.setPointerCapture(event.pointerId); onActiveChange(true);
    }
    function move(event: PointerEvent) {
      if (down?.id === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    async function up(event: PointerEvent) {
      if (down?.id !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const click = down; reset();
      if (pending.current || (measurement.points.length === 2 && !event.shiftKey) || Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) return;
      pending.current = true; setBusy(true); setMessage(null);
      try {
        const point = await picker.current!.pick(handle.camera(), click.u, click.v);
        if (!cancelled) {
          if (point) { measurement.add(point, event.shiftKey); redraw(); }
          else setMessage("No visible surface here. Click on the object.");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      } finally { pending.current = false; if (!cancelled) setBusy(false); }
    }
    function keyDown(event: Event) {
      const key = event as KeyboardEvent;
      if (key.repeat || key.altKey || (key.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const undo = (key.metaKey || key.ctrlKey) && key.key.toLowerCase() === "z";
      const focus = !key.metaKey && !key.ctrlKey && key.key.toLowerCase() === "f";
      if (!undo && !focus) return;
      key.preventDefault(); key.stopPropagation();
      if (pending.current) return;
      if (undo) { if (key.shiftKey) measurement.redo(); else measurement.undo(); redraw(); }
      else {
        const bounds = measurement.bounds() ?? handle.selection.bounds();
        if (bounds) focusSelection(bounds, handle.camera());
      }
    }
    canvas.addEventListener("pointerdown", pointerDown, true);
    canvas.addEventListener("pointermove", move, true);
    canvas.addEventListener("pointerup", up, true);
    canvas.addEventListener("pointercancel", reset, true);
    canvas.addEventListener("lostpointercapture", reset);
    frame.addEventListener("keydown", keyDown);
    return () => {
      cancelled = true; setBusy(false); setMessage(null);
      canvas.removeEventListener("pointerdown", pointerDown, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", up, true);
      canvas.removeEventListener("pointercancel", reset, true);
      canvas.removeEventListener("lostpointercapture", reset);
      frame.removeEventListener("keydown", keyDown);
      reset(); canvas.style.cursor = previousCursor;
    };
  }, [handle, active, measurement, onActiveChange]);
  return <>
    {(active || measurement.segments.length > 0) && <MeasurementOverlay handle={handle} measurement={measurement} />}
    {active && <div className="selection-actions measurement-actions" role="group" aria-label="Measurement">
      <span role="status">{busy ? "Picking surface…" : message ?? (measurement.points.length === 0 ? "Click the first surface point" : measurement.points.length === 1 ? "Click the second surface point" : "Shift-click to add another measurement")}</span>
      {measurement.distance !== null && <output aria-label="Measured distance">{formatDistance(measurement.distance)} model units</output>}
      <small>{assetType === "mesh" ? "GLB convention: meters. Physical scale unverified." : "This splat has no declared physical units."}</small>
      <button disabled={busy || measurement.points.length === 0} onClick={() => { measurement.clear(); setMessage(null); redraw(); }}>Clear measurements</button>
    </div>}
  </>;
}
