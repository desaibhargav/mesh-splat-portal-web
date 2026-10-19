import { useEffect, useState } from "react";
import { Color, Vec3 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { useSurfacePick } from "../picking/useSurfacePick";
import { captureFrame, threePointFrame, type ViewFrame } from "./viewFrame";

export function ThreePointAlignment({ handle, frame, onAlign, onCancel }: {
  handle: SelectionHandle; frame: ViewFrame; onAlign(frame: ViewFrame): void; onCancel(): void;
}) {
  const [points, setPoints] = useState<Vec3[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { busy, message } = useSurfacePick({ handle, active: true, acceptsClick: () => true,
    onPick: point => {
      setError(null);
      const next = [...points, point];
      if (next.length < 3) { setPoints(next); return; }
      try { onAlign(threePointFrame(captureFrame(handle.camera()), next as [Vec3, Vec3, Vec3])); }
      catch (error) { setError((error as Error).message); setPoints([]); }
    }
  });
  useEffect(() => {
    const radius = frame.distance * Math.tan(frame.fov * Math.PI / 360) / 100;
    const draw = () => {
      points.forEach(point => handle.app.drawWireSphere(point, radius, Color.WHITE));
      if (points.length === 2) handle.app.drawLine(points[0]!, points[1]!, Color.WHITE);
    };
    handle.app.on("prerender", draw);
    return () => { handle.app.off("prerender", draw); };
  }, [handle, frame, points]);
  return <>
    <span role="status">{busy ? "Picking surface…" : message ?? error ?? `Pick point ${points.length + 1} of 3: ${["origin", "X direction", "plane orientation"][points.length]}`}</span>
    <button onClick={onCancel}>Cancel three-point alignment</button>
  </>;
}
