import { useEffect, useRef } from "react";
import type { SelectionHandle } from "../selection/types";
import { ViewNavigation } from "../views/ViewNavigation";
import { useViewports } from "./useViewports";

export function ViewportToggle({ handle }: { handle: SelectionHandle }) {
  const rig = useViewports(handle);
  return <button aria-label="Four views" aria-pressed={rig.split} title="Toggle four views (Space)" onClick={() => rig.toggle()}>Four views</button>;
}

export function ViewportLayout({ handle }: { handle: SelectionHandle }) {
  const rig = useViewports(handle), hovering = useRef(false);
  useEffect(() => {
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    const activate = (event: MouseEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const panel = rig.at((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
      if (panel && (event.type === "pointerdown" || !event.buttons)) rig.activate(panel);
      hovering.current = !!panel;
    };
    const leave = () => { hovering.current = false; };
    const key = (event: KeyboardEvent) => {
      if (!hovering.current || event.code !== "Space" || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        (event.target as HTMLElement).closest("input, textarea, select, button, [contenteditable]:not([contenteditable=false])")) return;
      event.preventDefault(); rig.toggle();
    };
    canvas.addEventListener("pointermove", activate, true); canvas.addEventListener("pointerdown", activate, true);
    canvas.addEventListener("wheel", activate, true); canvas.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", key);
    return () => {
      canvas.removeEventListener("pointermove", activate, true); canvas.removeEventListener("pointerdown", activate, true);
      canvas.removeEventListener("wheel", activate, true); canvas.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", key);
    };
  }, [handle, rig]);
  return <div className={`viewport-layout ${rig.split ? "is-split" : ""}`} aria-label="Viewer panels">
    {rig.visible.map(panel => {
      const r = panel.camera.rect;
      return <div key={panel.id} className={`viewport-panel ${rig.active === panel ? "is-active" : ""}`} data-viewport={panel.id}
        style={{ left: `${r.x * 100}%`, top: `${(1 - r.y - r.w) * 100}%`, width: `${r.z * 100}%`, height: `${r.w * 100}%` }}>
        <button className="viewport-label" title="Restore perspective projection" onClick={() => rig.perspective(panel)}>{panel.label}</button>
        <div onPointerEnter={() => rig.activate(panel)}><ViewNavigation handle={handle} panel={panel} /></div>
      </div>;
    })}
  </div>;
}
