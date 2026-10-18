import { useEffect, useState } from "react";
import type { SelectionHandle } from "../selection/types";
import type { AnnotationRecord } from "./Annotations";

export function useAnnotationHover(handle: SelectionHandle, records: readonly AnnotationRecord[], active: boolean) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setHovered(null); setError(null);
    if (!active || !records.some(record => record.region)) return;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    let pending = false, cancelled = false, sequence = 0, frame = 0;
    let latest: { u: number; v: number; token: number } | null = null;
    function clear() { sequence++; latest = null; setHovered(null); }
    async function sample() {
      if (pending || !latest || cancelled) return;
      const { u, v, token } = latest; latest = null; pending = true;
      try {
        const hit = await handle.selection.primitiveAt(handle.app, handle.camera(), u, v);
        if (cancelled || token !== sequence) return;
        const record = hit && records.find(record => {
          const mask = record.region?.masks[hit.part];
          return mask && hit.index < mask.length && (mask.bits[hit.index >> 3]! & (1 << (hit.index & 7)));
        });
        setHovered(record ? record.id : null); setError(null);
      } catch (failure) {
        if (!cancelled) { setHovered(null); setError(failure instanceof Error ? failure.message : String(failure)); }
      } finally { pending = false; if (latest && !cancelled) frame = requestAnimationFrame(sample); }
    }
    function move(event: PointerEvent) {
      if (event.buttons || event.altKey) { clear(); return; }
      const bounds = canvas.getBoundingClientRect(), u = (event.clientX - bounds.left) / bounds.width, v = (event.clientY - bounds.top) / bounds.height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) { clear(); return; }
      latest = { u, v, token: ++sequence }; cancelAnimationFrame(frame); frame = requestAnimationFrame(sample);
    }
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerleave", clear);
    canvas.addEventListener("pointerdown", clear); canvas.addEventListener("wheel", clear);
    return () => {
      cancelled = true; cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerleave", clear);
      canvas.removeEventListener("pointerdown", clear); canvas.removeEventListener("wheel", clear);
    };
  }, [handle, records, active]);
  return { hovered, error };
}
