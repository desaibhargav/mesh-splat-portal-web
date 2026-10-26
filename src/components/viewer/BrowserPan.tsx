import { useEffect, useRef } from "react";
import { PROJECTION_ORTHOGRAPHIC, Vec3, type Pose } from "playcanvas";
import { cameraControls, type CameraControls } from "./CameraControls";
import type { SelectionHandle } from "./selection/types";

// A 2D headset browser sends a primary pointer for either controller, without
// WebXR handedness. An explicit Pan mode lets that pointer pan the same camera.
export function BrowserPan({ handle }: { handle: SelectionHandle }) {
  const active = useRef<CameraControls | null>(null);
  const start = useRef<{ x: number; y: number; pose: Pose; right: Vec3; up: Vec3; units: number } | null>(null);
  useEffect(() => () => { if (active.current) active.current.enabled = true; }, []);
  return <div className="viewer-pan-surface" aria-label="Drag to pan" onPointerDown={event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    const panel = handle.viewports.at(u, v);
    if (!panel) return;
    handle.viewports.activate(panel);
    const camera = panel.camera, control = cameraControls(camera), pose = control.capturePose();
    const panelHeight = rect.height * camera.rect.w;
    const units = camera.projection === PROJECTION_ORTHOGRAPHIC ? camera.orthoHeight * 2 / panelHeight :
      2 * pose.distance * Math.tan(camera.fov * Math.PI / 360) / panelHeight;
    start.current = { x: event.clientX, y: event.clientY, pose,
      right: camera.entity.right.clone(), up: camera.entity.up.clone(), units };
    active.current = control; control.enabled = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }} onPointerMove={event => {
    const gesture = start.current, control = active.current;
    if (!gesture || !control) return;
    const moved = gesture.pose.clone();
    moved.position.add(gesture.right.clone().mulScalar((gesture.x - event.clientX) * gesture.units));
    moved.position.add(gesture.up.clone().mulScalar((event.clientY - gesture.y) * gesture.units));
    control.restorePose(moved); handle.app.renderNextFrame = true;
  }} onPointerUp={() => {
    if (active.current) active.current.enabled = true;
    active.current = null; start.current = null;
  }} onPointerCancel={() => {
    if (active.current) active.current.enabled = true;
    active.current = null; start.current = null;
  }} />;
}
