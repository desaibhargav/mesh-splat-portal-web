import { BoundingBox, PROJECTION_ORTHOGRAPHIC, Vec2, Vec3, type CameraComponent } from "playcanvas";
import type { CameraControls } from "playcanvas/scripts/esm/camera-controls.mjs";

// Fit all eight bounds corners from the current viewing direction, accounting for aspect ratio.
export function focusPosition(bounds: BoundingBox, camera: Pick<CameraComponent, "entity" | "fov" | "horizontalFov" | "aspectRatio" | "nearClip">): Vec3 {
  const tangent = Math.tan(camera.fov * Math.PI / 360);
  const tanX = camera.horizontalFov ? tangent : tangent * camera.aspectRatio;
  const tanY = camera.horizontalFov ? tangent / camera.aspectRatio : tangent;
  const right = camera.entity.right, up = camera.entity.up, back = camera.entity.forward.clone().mulScalar(-1);
  let distance = camera.nearClip;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const corner = new Vec3(x * bounds.halfExtents.x, y * bounds.halfExtents.y, z * bounds.halfExtents.z);
    distance = Math.max(distance, Math.abs(corner.dot(right)) / tanX + corner.dot(back),
      Math.abs(corner.dot(up)) / tanY + corner.dot(back));
  }
  return back.mulScalar(distance * 1.1).add(bounds.center);
}
export function focusSelection(bounds: BoundingBox, camera: CameraComponent) {
  const controls = camera.entity.script?.get("cameraControls") as CameraControls | undefined;
  if (!controls) throw new Error("Camera controls are unavailable.");
  const position = bounds.halfExtents.lengthSq() === 0 ? camera.entity.forward.clone()
    .mulScalar(-camera.entity.getPosition().distance(controls.focusPoint)).add(bounds.center) : focusPosition(bounds, camera);
  if (camera.projection === PROJECTION_ORTHOGRAPHIC && bounds.halfExtents.lengthSq() > 0) {
    camera.orthoHeight = orthographicHeight(bounds, camera);
  }
  camera.entity.setPosition(position);
  // The public focusPoint setter synchronizes the orbit pose immediately, even in selection mode.
  controls.focusPoint = bounds.center.clone();
  camera.entity.lookAt(bounds.center);
  const distance = position.distance(bounds.center);
  camera.nearClip = Math.min(camera.nearClip, distance / 100);
  controls.zoomRange = new Vec2(Math.min(controls.zoomRange.x, distance / 100), controls.zoomRange.y);
}

// Project the eight box corners onto the camera axes; no geometry traversal.
export function orthographicHeight(bounds: BoundingBox, camera: Pick<CameraComponent, "entity" | "aspectRatio">): number {
  const right = camera.entity.right, up = camera.entity.up;
  let height = 0;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const corner = new Vec3(x * bounds.halfExtents.x, y * bounds.halfExtents.y, z * bounds.halfExtents.z);
    height = Math.max(height, Math.abs(corner.dot(up)), Math.abs(corner.dot(right)) / camera.aspectRatio);
  }
  return height * 1.1;
}
