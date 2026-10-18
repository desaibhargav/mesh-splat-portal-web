import { useEffect, useRef } from "react";
import { Vec3 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { formatDistance, type Measurement } from "./Measurement";

export function MeasurementOverlay({ handle, measurement }: { handle: SelectionHandle; measurement: Measurement }) {
  return <div className="measurement-overlay" aria-hidden="true"><svg>
    {measurement.segments.map((points, index) => <MeasurementSegment key={index} handle={handle} points={points} />)}
  </svg></div>;
}

function MeasurementSegment({ handle, points }: { handle: SelectionHandle; points: readonly Vec3[] }) {
  const distance = points.length === 2 ? points[0]!.distance(points[1]!) : null;
  const markers = useRef<(SVGGElement | null)[]>([]);
  const segment = useRef<SVGLineElement>(null);
  const label = useRef<SVGTextElement>(null);
  useEffect(() => {
    const projected = [new Vec3(), new Vec3()], delta = new Vec3();
    let last = "";
    function update() {
      const camera = handle.camera();
      const visible = projected.map((screen, i) => {
        if (!points[i]) return false;
        const distance = delta.sub2(points[i]!, camera.entity.getPosition()).dot(camera.entity.forward);
        camera.worldToScreen(points[i]!, screen);
        return distance >= camera.nearClip && distance <= camera.farClip && Number.isFinite(screen.x) && Number.isFinite(screen.y);
      });
      const state = projected.map((p, i) => `${visible[i]}:${p.x}:${p.y}`).join(";") + distance;
      if (state === last) return;
      last = state;
      projected.forEach((p, i) => {
        markers.current[i]!.style.display = visible[i] ? "" : "none";
        markers.current[i]!.setAttribute("transform", `translate(${p.x},${p.y})`);
      });
      const lineVisible = visible.every(Boolean);
      segment.current!.style.display = label.current!.style.display = lineVisible ? "" : "none";
      if (lineVisible) {
        const a = projected[0]!, b = projected[1]!;
        for (const [attribute, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) segment.current!.setAttribute(attribute, String(value));
        label.current!.setAttribute("x", String((a.x + b.x) / 2));
        label.current!.setAttribute("y", String((a.y + b.y) / 2 - 12));
        label.current!.textContent = `${formatDistance(distance!)} model units`;
      }
    }
    update(); handle.app.on("postrender", update);
    return () => { handle.app.off("postrender", update); };
  }, [handle, points, distance]);
  return <>
    <line ref={segment} />
    {["A", "B"].map((name, i) => <g key={name} ref={element => { markers.current[i] = element; }} style={{ display: "none" }}>
      <circle r="5" /><text x="10" y="-8">{name}</text>
    </g>)}
    <text ref={label} textAnchor="middle" />
  </>;
}
