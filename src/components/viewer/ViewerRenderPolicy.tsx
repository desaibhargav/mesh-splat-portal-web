import { useApp } from "@playcanvas/react/hooks";
import { Mat4, type CameraComponent } from "playcanvas";
import { useEffect, type RefObject } from "react";
import type { SelectionHandle, SelectionTool } from "./selection/types";
import type { SegmentWorkspaces } from "./segments/SegmentWorkspaces";

const textEntry = "input:not([type=range]):not([type=color]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable]:not([contenteditable=false])";

// Passive inspection leaves the GPU idle. Native updates continue so camera
// damping, DOM annotations and completed splat sorts can request the next frame.
// Interactive tools and tracked XR sessions retain continuous rendering.
export function ViewerRenderPolicy({ scope, handle, workspaces, tool, splat }: {
  scope: RefObject<HTMLElement | null>; handle: SelectionHandle | null;
  workspaces: SegmentWorkspaces | null; tool: SelectionTool; splat: boolean;
}) {
  const app = useApp();
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const splats = app.systems.gsplat, device = app.graphicsDevice, xr = app.xr;
    const cameras = new Map<CameraComponent, { world: Mat4; projection: Mat4 }>();
    let typing = false;
    let ready = !splat;
    const draw = () => { app.renderNextFrame = true; };
    const mode = () => {
      app.autoRender = !!app.xr?.active || (!typing && (!handle || !ready || tool !== "navigate"));
    };
    const frameReady = (_camera: CameraComponent, _layer: unknown, complete: boolean, loading: number) => {
      if (complete && !loading) { ready = true; mode(); }
    };
    const syncFocus = () => {
      const focused = document.activeElement;
      const wasTyping = typing;
      typing = !!focused && root.contains(focused) && focused.matches(textEntry);
      mode();
      if (wasTyping && !typing) draw();
    };
    const focusOut = () => { queueMicrotask(syncFocus); };
    const update = () => {
      mode();
      if (typing && !app.xr?.active) { app.renderNextFrame = false; return; }
      if (app.autoRender || !handle) return;
      for (const { camera } of handle.viewports.panels) {
        if (!camera.enabled) continue;
        const world = camera.entity.getWorldTransform(), projection = camera.projectionMatrix;
        const last = cameras.get(camera);
        if (!last) { cameras.set(camera, { world: world.clone(), projection: projection.clone() }); draw(); }
        else if (!last.world.equals(world) || !last.projection.equals(projection)) {
          last.world.copy(world); last.projection.copy(projection); draw();
        }
      }
    };
    root.addEventListener("focusin", syncFocus); root.addEventListener("focusout", focusOut);
    app.on("framerender", update);
    splats?.on("frame:request", draw);
    splats?.on("frame:ready", frameReady);
    device.on("resizecanvas", draw);
    xr?.on("start", syncFocus); xr?.on("end", syncFocus);
    handle?.viewports.on("change", draw); handle?.space.on("change", draw);
    workspaces?.on("change", draw);
    syncFocus(); draw();
    return () => {
      root.removeEventListener("focusin", syncFocus); root.removeEventListener("focusout", focusOut);
      app.off("framerender", update);
      splats?.off("frame:request", draw);
      splats?.off("frame:ready", frameReady);
      device.off("resizecanvas", draw);
      xr?.off("start", syncFocus); xr?.off("end", syncFocus);
      handle?.viewports.off("change", draw); handle?.space.off("change", draw);
      workspaces?.off("change", draw);
      app.autoRender = true; draw();
    };
  }, [app, scope, handle, workspaces, tool, splat]);
  return null;
}
