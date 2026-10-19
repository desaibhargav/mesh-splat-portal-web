import { BoundingBox, Mat4, Plane, Quat, Vec3, type AppBase } from "playcanvas";
import { copyFrame, type ViewFrame } from "../views/viewFrame";

export interface SectionOptions { offset: number; tiltX: number; tiltY: number; flip: boolean }

export function sectionFrame(reference: ViewFrame, bounds: BoundingBox, options: SectionOptions): ViewFrame {
  const rotation = reference.rotation.clone().mul(new Quat().setFromEulerAngles(options.tiltX, options.tiltY, 0));
  const normal = rotation.transformVector(Vec3.BACK, new Vec3());
  const extent = Math.abs(normal.x) * bounds.halfExtents.x + Math.abs(normal.y) * bounds.halfExtents.y + Math.abs(normal.z) * bounds.halfExtents.z;
  const span = Math.abs(normal.dot(bounds.center.clone().sub(reference.origin))) + extent;
  const origin = reference.origin.clone().add(normal.mulScalar(options.offset * span));
  return { ...reference, origin, rotation };
}

// View from the removed half-space into the retained geometry. A local half
// turn reverses the normal while preserving the reference's upright direction.
export function cutawayView(frame: ViewFrame, flip: boolean): ViewFrame {
  const view = copyFrame(frame);
  if (!flip) view.rotation.mul(new Quat().setFromAxisAngle(Vec3.UP, 180));
  return view;
}

export function planeCoefficients(frame: ViewFrame, flip: boolean): Float32Array {
  const normal = frame.rotation.transformVector(Vec3.BACK, new Vec3()).mulScalar(flip ? -1 : 1);
  const plane = new Plane().setFromPointNormal(frame.origin, normal);
  return new Float32Array([normal.x, normal.y, normal.z, plane.distance]);
}

export function setSectionPlane(app: AppBase, plane: Float32Array | null) {
  app.graphicsDevice.scope.resolve("portalSectionPlane").setValue(plane ?? new Float32Array(4));
  app.graphicsDevice.scope.resolve("portalSectionEnabled").setValue(plane ? 1 : 0);
}

// Transform a world plane into local coefficients once per selection gesture;
// each already-required centroid test then needs only a dot product.
export function sectionTest(app: AppBase, positions: Float32Array, transform: Mat4): ((index: number) => boolean) | undefined {
  if (!app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue()) return;
  const plane = app.graphicsDevice.scope.resolve("portalSectionPlane").getValue() as Float32Array;
  const m = transform.data;
  const local = [0, 1, 2, 3].map(column => plane.reduce((sum, value, row) => sum + value * m[column * 4 + row]!, 0));
  return index => local[0]! * positions[index * 3]! + local[1]! * positions[index * 3 + 1]! + local[2]! * positions[index * 3 + 2]! + local[3]! >= 0;
}
