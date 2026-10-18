import { useEffect, useEffectEvent, useState } from "react";
import type { Vec3 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { SurfacePicker } from "./SurfacePicker";

// Shared click interaction for tools that place points on the visible model.
export function useSurfacePick({ handle, active, acceptsClick, validateClick, onPick }: {
  handle: SelectionHandle; active: boolean;
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
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    const cursor = canvas.style.cursor, touchAction = canvas.style.touchAction;
    canvas.style.cursor = "crosshair"; canvas.style.touchAction = "none";
    let down: { id: number; x: number; y: number; u: number; v: number } | null = null;
    let pending = false, cancelled = false;
    function reset() { down = null; }
    function pointerDown(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || event.altKey) return;
      const bounds = canvas.getBoundingClientRect();
      down = { id: event.pointerId, x: event.clientX, y: event.clientY,
        u: (event.clientX - bounds.left) / bounds.width, v: (event.clientY - bounds.top) / bounds.height };
    }
    async function up(event: PointerEvent) {
      if (down?.id !== event.pointerId) return;
      const click = down, shift = event.shiftKey; reset();
      if (pending || !accepts(shift) || Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) return;
      pending = true; setBusy(true); setMessage(null);
      try {
        const validation = await validate(click.u, click.v);
        if (validation) { if (!cancelled) setMessage(validation); return; }
        const point = await picker.pick(handle.camera(), click.u, click.v);
        if (!cancelled) {
          if (point) apply(point, shift);
          else setMessage("No visible surface here. Click on the object.");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      } finally { pending = false; if (!cancelled) setBusy(false); }
    }
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", reset);
    return () => {
      cancelled = true; picker.destroy(); setBusy(false); setMessage(null);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", reset);
      reset(); canvas.style.cursor = cursor; canvas.style.touchAction = touchAction;
    };
  }, [handle, active]);
  return { busy, message, clearMessage: () => setMessage(null) };
}
