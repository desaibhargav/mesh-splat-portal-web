import { useEffect, useState } from "react";
import type { SelectionHandle } from "../selection/types";

export interface PrimitiveHit { part: number; index: number }

// Coalesce pointer motion into one GPU readback at a time and keep only the
// latest requested pixel. Mesh and splat controllers provide the same picker.
export function usePrimitiveHover(handle: SelectionHandle, active: boolean) {
  const [hit, setHit] = useState<PrimitiveHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setHit(null); setError(null);
    if (!active) return;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    let pending = false, cancelled = false, sequence = 0, frame = 0;
    let latest: { u: number; v: number; token: number } | null = null;
    function clear() { sequence++; latest = null; cancelAnimationFrame(frame); frame = 0; setHit(null); }
    async function sample() {
      frame = 0;
      if (pending || !latest || cancelled) return;
      const { u, v, token } = latest; latest = null; pending = true;
      try {
        const next = await handle.selection.primitiveAt(handle.app, handle.camera(), u, v);
        if (cancelled || token !== sequence) return;
        setHit(next); setError(null);
      } catch (failure) {
        if (!cancelled) { setHit(null); setError(failure instanceof Error ? failure.message : String(failure)); }
      } finally { pending = false; if (latest && !cancelled) frame = requestAnimationFrame(sample); }
    }
    function move(event: PointerEvent) {
      if (event.buttons || event.altKey) { clear(); return; }
      const bounds = canvas.getBoundingClientRect();
      const u = (event.clientX - bounds.left) / bounds.width, v = (event.clientY - bounds.top) / bounds.height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) { clear(); return; }
      latest = { u, v, token: sequence };
      if (!pending && !frame) frame = requestAnimationFrame(sample);
    }
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerleave", clear);
    canvas.addEventListener("pointerdown", clear); canvas.addEventListener("wheel", clear);
    return () => {
      cancelled = true; cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerleave", clear);
      canvas.removeEventListener("pointerdown", clear); canvas.removeEventListener("wheel", clear);
    };
  }, [handle, active]);
  return { hit, error };
}
