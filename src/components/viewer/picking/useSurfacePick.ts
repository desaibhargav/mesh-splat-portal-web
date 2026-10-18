import { useEffect, useEffectEvent, useState } from "react";
import type { Vec3 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { observePointerClick } from "./pointerClick";
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
    let pending = false, cancelled = false;
    function identify(event: PointerEvent) {
      const bounds = canvas.getBoundingClientRect();
      return { u: (event.clientX - bounds.left) / bounds.width, v: (event.clientY - bounds.top) / bounds.height };
    }
    async function click(point: { u: number; v: number }, event: PointerEvent) {
      const shift = event.shiftKey;
      if (pending || !accepts(shift)) return;
      pending = true; setBusy(true); setMessage(null);
      try {
        const validation = await validate(point.u, point.v);
        if (validation) { if (!cancelled) setMessage(validation); return; }
        const position = await picker.pick(handle.camera(), point.u, point.v);
        if (!cancelled) {
          if (position) apply(position, shift);
          else setMessage("No visible surface here. Click on the object.");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      } finally { pending = false; if (!cancelled) setBusy(false); }
    }
    const stop = observePointerClick(canvas, identify, (point, event) => void click(point, event));
    return () => {
      cancelled = true; picker.destroy(); setBusy(false); setMessage(null);
      stop(); canvas.style.cursor = cursor; canvas.style.touchAction = touchAction;
    };
  }, [handle, active]);
  return { busy, message, clearMessage: () => setMessage(null) };
}
