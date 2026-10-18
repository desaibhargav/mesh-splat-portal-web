import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import { usePrimitiveHover } from "../picking/usePrimitiveHover";
import type { SelectionArea, SelectionHandle } from "../selection/types";

export function useSelectionAreaPick(handle: SelectionHandle, active: boolean, onPick: (area: SelectionArea) => void) {
  const { hit, error } = usePrimitiveHover(handle, active);
  const area = useMemo(() => hit && handle.selection.areaAt(hit.part, hit.index), [handle, hit]);
  const areaRef = useRef(area);
  areaRef.current = area;
  const pick = useEffectEvent(onPick);
  useEffect(() => {
    handle.selection.previewArea(active ? area : null);
    return () => handle.selection.previewArea(null);
  }, [handle, active, area]);
  useEffect(() => {
    if (!active) return;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    const cursor = canvas.style.cursor;
    let down: { id: number; x: number; y: number; area: SelectionArea } | null = null;
    function pointerDown(event: PointerEvent) {
      const candidate = areaRef.current;
      if (!candidate || !event.isPrimary || event.button !== 0 || event.altKey) return;
      down = { id: event.pointerId, x: event.clientX, y: event.clientY, area: candidate };
    }
    function pointerUp(event: PointerEvent) {
      if (down?.id !== event.pointerId) return;
      const click = down; down = null;
      if (Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 4) pick(click.area);
    }
    const reset = () => { down = null; };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", reset);
    return () => {
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", reset);
      canvas.style.cursor = cursor;
    };
  }, [handle, active]);
  useEffect(() => {
    if (!active) return;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    canvas.style.cursor = area ? "pointer" : "crosshair";
  }, [handle, active, area]);
  return { area, error };
}
