import { useEffect, useEffectEvent, useMemo } from "react";
import { usePrimitiveHover } from "../picking/usePrimitiveHover";
import type { SelectionArea, SelectionHandle } from "../selection/types";

export function useSelectionAreaPick(handle: SelectionHandle, active: boolean, onPick: (area: SelectionArea) => void) {
  const { hit, error } = usePrimitiveHover(handle, active);
  const area = useMemo(() => hit && handle.selection.areaAt(hit.part, hit.index), [handle, hit]);
  const pick = useEffectEvent(onPick);
  useEffect(() => {
    handle.selection.previewArea(active ? area : null);
    return () => handle.selection.previewArea(null);
  }, [handle, active, area]);
  useEffect(() => {
    if (!active) return;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    const cursor = canvas.style.cursor;
    canvas.style.cursor = area ? "pointer" : "crosshair";
    function pointerDown(event: PointerEvent) {
      if (!area || !event.isPrimary || event.button !== 0 || event.altKey) return;
      event.preventDefault(); event.stopImmediatePropagation(); pick(area);
    }
    canvas.addEventListener("pointerdown", pointerDown, true);
    return () => { canvas.removeEventListener("pointerdown", pointerDown, true); canvas.style.cursor = cursor; };
  }, [handle, active, area]);
  return { area, error };
}
