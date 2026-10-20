import { PROJECTION_ORTHOGRAPHIC, type BoundingBox, type CameraComponent } from "playcanvas";

// Display policy in object-radius units, independent of asset coordinates.
export const LOD_TRANSITIONS = [0, 2, 4] as const;
export const LOD_HYSTERESIS = 0.1;
// Native splat LOD updates are distance-gated; scale the gate to the asset.
export const LOD_UPDATE_DISTANCE_RATIO = 0.05;
const referenceFov = Math.tan(Math.PI / 8);

export function lodMetric(camera: CameraComponent, bounds: BoundingBox): number {
  const radius = bounds.halfExtents.length();
  if (radius <= 0) return 0;
  if (camera.projection === PROJECTION_ORTHOGRAPHIC) {
    return Math.max(0, camera.orthoHeight / referenceFov - radius) / radius;
  }
  const fovScale = Math.min(camera.aspectRatio, 1) * Math.tan(camera.fov * Math.PI / 360) /
    (referenceFov * (camera.horizontalFov ? camera.aspectRatio : 1));
  return Math.max(0, camera.entity.getPosition().distance(bounds.center) - radius) * fovScale / radius;
}
