import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import { observePointerClick } from "../picking/pointerClick";
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
    const stop = observePointerClick(canvas, () => areaRef.current, pick);
    return () => {
      stop(); canvas.style.cursor = cursor;
    };
  }, [handle, active]);
  useEffect(() => {
    if (!active) return;
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    canvas.style.cursor = area ? "pointer" : "crosshair";
  }, [handle, active, area]);
  return { area, error };
}
