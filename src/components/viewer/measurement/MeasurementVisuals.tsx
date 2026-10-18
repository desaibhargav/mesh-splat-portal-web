import { useEffect, useRef } from "react";
import type { Vec3 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { MeasurementRenderer, type MeasurementStyle } from "./MeasurementRenderer";

export function MeasurementVisuals({ handle, segments, style }: {
  handle: SelectionHandle; segments: readonly (readonly Vec3[])[]; style: MeasurementStyle;
}) {
  const renderer = useRef<MeasurementRenderer | null>(null);
  useEffect(() => {
    const visuals = new MeasurementRenderer(handle); renderer.current = visuals;
    return () => { visuals.destroy(); renderer.current = null; };
  }, [handle]);
  useEffect(() => { renderer.current!.setSegments(segments); }, [handle, segments]);
  useEffect(() => { renderer.current!.setStyle(style); }, [handle, style]);
  return null;
}
