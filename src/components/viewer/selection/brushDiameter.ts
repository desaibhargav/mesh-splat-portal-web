import { PROJECTION_ORTHOGRAPHIC, Vec3, type BoundingBox, type CameraComponent } from "playcanvas";

// A view-relative diameter: bounds are cached per gesture owner, projection is only
// eight corners on pointer input. No geometry scan or permanent render callback.
export function brushDiameter(bounds: BoundingBox, camera: CameraComponent, percent: number): number {
  const corner = new Vec3(), screen = new Vec3(), min = bounds.getMin(), max = bounds.getMax();
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
    // Perspective projection is undefined behind the eye. Project such corners
    // onto the near plane along the camera's forward direction instead.
    const depth = new Vec3().sub2(corner, camera.entity.getPosition()).dot(camera.entity.forward);
    if (camera.projection !== PROJECTION_ORTHOGRAPHIC && depth < camera.nearClip) {
      corner.add(camera.entity.forward.clone().mulScalar(camera.nearClip - depth));
    }
    camera.worldToScreen(corner, screen);
    left = Math.min(left, screen.x); right = Math.max(right, screen.x);
    top = Math.min(top, screen.y); bottom = Math.max(bottom, screen.y);
  }
  return Math.max(right - left, bottom - top) * percent / 100;
}
