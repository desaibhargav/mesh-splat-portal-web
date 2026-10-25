import { useEffect, useEffectEvent, useState } from "react";
import { Mat4, type Vec3 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { observePointerClick } from "./pointerClick";
import { SurfacePicker } from "./SurfacePicker";
import { SurfacePointMarker } from "./SurfacePointMarker";
import { pickSurfaceRay, pointerRay } from "./surfaceRay";

// Shared click interaction for tools that place points on the visible model.
export function useSurfacePick({ handle, active, acceptsClick, validateClick, onPick, cursorStyle, surfacePreview = false }: {
  handle: SelectionHandle; active: boolean;
  cursorStyle?: string;
  surfacePreview?: boolean;
  acceptsClick(shift: boolean): boolean;
  validateClick?(u: number, v: number): Promise<string | null>;
  onPick(point: Vec3, shift: boolean): void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const accepts = useEffectEvent(acceptsClick), validate = useEffectEvent(validateClick ?? (async () => null));
  const apply = useEffectEvent(onPick);
  useEffect(() => {
    if (!active) return;
    const picker = new SurfacePicker(handle.app, handle.selection.layers);
    const marker = surfacePreview ? new SurfacePointMarker(handle) : null;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    const cursor = canvas.style.cursor, touchAction = canvas.style.touchAction;
    canvas.style.cursor = cursorStyle ?? "crosshair"; canvas.style.touchAction = "none";
    let pending = false, cancelled = false;
    let hover: { u: number; v: number; shift: boolean; buttons: number } | null = null;
    let hoverPending = false, dirty = true, lastU = -1, lastV = -1;
    const view = new Mat4(), projection = new Mat4(), model = new Mat4();
    function identify(event: PointerEvent) {
      const bounds = canvas.getBoundingClientRect();
      return { u: (event.clientX - bounds.left) / bounds.width, v: (event.clientY - bounds.top) / bounds.height };
    }
    async function click(point: { u: number; v: number }, event: PointerEvent) {
      const shift = event.shiftKey, camera = handle.viewports.at(point.u, point.v)?.camera ?? handle.camera();
      if (pending || !accepts(shift)) return;
      pending = true; setBusy(true); setMessage(null);
      try {
        const validation = await validate(point.u, point.v);
        if (validation) { if (!cancelled) setMessage(validation); return; }
        const ray = surfacePreview ? pointerRay(handle, camera, point.u, point.v) : null;
        const local = ray ? await pickSurfaceRay(handle, ray.origin, ray.direction) : null;
        const position = surfacePreview ? (local && handle.space.toWorld(local)) : await picker.pick(camera, point.u, point.v);
        if (!cancelled) {
          if (position) apply(position, shift);
          else setMessage("No visible surface here. Click on the object.");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      } finally { pending = false; if (!cancelled) setBusy(false); }
    }
    function pointerMove(event: PointerEvent) { hover = { ...identify(event), shift: event.shiftKey, buttons: event.buttons }; }
    function pointerLeave() { hover = null; dirty = true; marker?.set(null); }
    function preview() {
      if (!marker || cancelled || handle.app.xr?.active) return;
      if (!hover || hover.buttons || !accepts(hover.shift)) { marker.set(null); dirty = true; return; }
      if (pending || hoverPending) return;
      const camera = handle.viewports.at(hover.u, hover.v)?.camera;
      if (!camera) { marker.set(null); return; }
      const transform = handle.space.root.getWorldTransform();
      if (!dirty && hover.u === lastU && hover.v === lastV && view.equals(camera.viewMatrix) &&
        projection.equals(camera.projectionMatrix) && model.equals(transform)) return;
      dirty = false; lastU = hover.u; lastV = hover.v;
      view.copy(camera.viewMatrix); projection.copy(camera.projectionMatrix); model.copy(transform);
      const ray = pointerRay(handle, camera, hover.u, hover.v);
      hoverPending = true;
      void pickSurfaceRay(handle, ray.origin, ray.direction).then(point => {
        if (!cancelled) marker.set(hover && !hover.buttons ? point : null, camera);
      }).catch(error => { if (!cancelled) { marker.set(null); setMessage(error instanceof Error ? error.message : String(error)); } })
        .finally(() => { hoverPending = false; });
    }
    if (marker) {
      canvas.addEventListener("pointermove", pointerMove); canvas.addEventListener("pointerleave", pointerLeave);
      handle.app.on("update", preview);
    }
    const stop = observePointerClick(canvas, identify, (point, event) => void click(point, event));
    return () => {
      cancelled = true; picker.destroy(); setBusy(false); setMessage(null);
      canvas.removeEventListener("pointermove", pointerMove); canvas.removeEventListener("pointerleave", pointerLeave);
      handle.app.off("update", preview); marker?.destroy();
      stop(); canvas.style.cursor = cursor; canvas.style.touchAction = touchAction;
    };
  }, [handle, active, cursorStyle, surfacePreview]);
  return { busy, message, clearMessage: () => setMessage(null) };
}
