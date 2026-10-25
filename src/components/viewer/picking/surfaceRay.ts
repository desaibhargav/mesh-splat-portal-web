import { Mat4, Vec3, type CameraComponent } from "playcanvas";
import type { SelectionHandle } from "../selection/types";

// Return object-space hits using the transform at query time. Worker results
// may arrive after an XR grab/zoom; converting with the later transform would
// store the wrong anchor and make measurements drift away from their surface.
export async function pickSurfaceRay(handle: SelectionHandle, origin: Vec3, direction: Vec3) {
  const inverse = new Mat4().invert(handle.space.root.getWorldTransform());
  const point = await handle.selection.pickRay(origin.clone(), direction.clone());
  return point ? inverse.transformPoint(point) : null;
}

export function pointerRay(handle: SelectionHandle, camera: CameraComponent, u: number, v: number) {
  const rect = handle.app.graphicsDevice.clientRect;
  const origin = camera.screenToWorld(u * rect.width, v * rect.height, camera.nearClip);
  const target = camera.screenToWorld(u * rect.width, v * rect.height, camera.farClip);
  return { origin, direction: target.sub(origin).normalize() };
}
