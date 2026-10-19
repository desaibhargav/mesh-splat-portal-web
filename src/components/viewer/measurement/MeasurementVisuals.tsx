import { useViewports } from "../viewports/useViewports";
import { useViewportHandle } from "../viewports/useViewportHandle";
import type { Viewport } from "../viewports/ViewerViewports";
import { useEffect, useRef } from "react";
import type { Vec3 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { MeasurementRenderer, type MeasurementStyle } from "./MeasurementRenderer";

export function MeasurementVisuals({ handle, segments, style }: {
  handle: SelectionHandle; segments: readonly (readonly Vec3[])[]; style: MeasurementStyle;
}) {
  const rig = useViewports(handle);
  return <>{rig.visible.map(panel => <MeasurementViewport key={panel.id} handle={handle} panel={panel} segments={segments} style={style} />)}</>;
}

function MeasurementViewport({ handle: shared, panel, segments, style }: {
  handle: SelectionHandle; panel: Viewport; segments: readonly (readonly Vec3[])[]; style: MeasurementStyle;
}) {
  const handle = useViewportHandle(shared, panel);
  const renderer = useRef<MeasurementRenderer | null>(null);
  useEffect(() => {
    const visuals = new MeasurementRenderer(handle); renderer.current = visuals;
    return () => { visuals.destroy(); renderer.current = null; };
  }, [handle]);
  useEffect(() => { renderer.current!.setSegments(segments); }, [handle, segments]);
  useEffect(() => { renderer.current!.setStyle(style); }, [handle, style]);
  return null;
}
