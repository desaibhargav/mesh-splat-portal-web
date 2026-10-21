import { Mat4, Pose, Quat, Vec3, type CameraComponent } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { cameraControls } from "../CameraControls";

// Origin is the reference-plane center and orbit pivot. Local +Z faces the
// camera; local X/Y span its section reference plane. Scale has no role here.
export interface ViewFrame { origin: Vec3; rotation: Quat; distance: number; fov: number; projection?: number; orthoHeight?: number }
export interface NamedView { id: number; name: string; frame: ViewFrame; assetRotation: Quat }
export type ViewAxis = "X" | "Y" | "Z";

export function axisFrame(frame: ViewFrame, axis: ViewAxis): ViewFrame {
  const normal = { X: Vec3.RIGHT, Y: Vec3.UP, Z: Vec3.BACK }[axis];
  return directionFrame(frame, normal);
}

export function directionFrame(frame: ViewFrame, normal: Vec3): ViewFrame {
  const rotation = new Quat().setFromMat4(new Mat4().setLookAt(Vec3.ZERO, normal.clone().mulScalar(-1), Math.abs(normal.y) === 1 ? Vec3.FORWARD : Vec3.UP));
  return { ...copyFrame(frame), rotation };
}

export function threePointFrame(frame: ViewFrame, points: readonly [Vec3, Vec3, Vec3]): ViewFrame {
  const [origin, second, third] = points;
  const x = second.clone().sub(origin), other = third.clone().sub(origin);
  const normal = new Vec3().cross(x, other);
  if (x.lengthSq() === 0 || other.lengthSq() === 0 || normal.lengthSq() <= Number.EPSILON * x.lengthSq() * other.lengthSq()) {
    throw new Error("Choose three distinct, non-collinear points.");
  }
  normal.normalize(); x.normalize();
  // A plane has two normals. Keep the view on the user's current side rather
  // than making click winding unexpectedly send the camera behind the object.
  if (normal.dot(frame.rotation.transformVector(Vec3.BACK, new Vec3())) < 0) normal.mulScalar(-1);
  const up = new Vec3().cross(normal, x).normalize();
  const rotation = new Quat().setFromMat4(new Mat4().setLookAt(origin, origin.clone().sub(normal), up));
  return { ...copyFrame(frame), origin: origin.clone(), rotation };
}

export function copyFrame(frame: ViewFrame): ViewFrame {
  return { ...frame, origin: frame.origin.clone(), rotation: frame.rotation.clone() };
}

export function captureFrame(camera: CameraComponent): ViewFrame {
  const controls = cameraControls(camera);
  const origin = controls.focusPoint.clone();
  return { origin, rotation: camera.entity.getRotation().clone(),
    distance: camera.entity.getPosition().distance(origin), fov: camera.fov, projection: camera.projection, orthoHeight: camera.orthoHeight };
}

export function framePose(frame: ViewFrame): Pose {
  const position = frame.rotation.transformVector(Vec3.BACK, new Vec3())
    .mulScalar(frame.distance).add(frame.origin);
  return new Pose(position, frame.rotation.getEulerAngles(), frame.distance);
}

export function recallFrame(camera: CameraComponent, frame: ViewFrame) {
  const controls = cameraControls(camera);
  camera.fov = frame.fov;
  if (frame.projection !== undefined) camera.projection = frame.projection;
  if (frame.orthoHeight !== undefined) camera.orthoHeight = frame.orthoHeight;
  controls.restorePose(framePose(frame));
}

export function restoreView(handle: SelectionHandle, view: NamedView) {
  handle.space.setRotation(view.assetRotation); handle.viewports.restore(view.frame);
}
