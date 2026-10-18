import { Pose, Quat, Vec3, type CameraComponent } from "playcanvas";
import { cameraControls } from "../CameraControls";

// Origin is the reference-plane center and orbit pivot. Local +Z faces the
// camera; local X/Y span the future section plane. Scale has no role here.
export interface ViewFrame { origin: Vec3; rotation: Quat; distance: number; fov: number }
export interface NamedView { id: number; name: string; frame: ViewFrame }

export function copyFrame(frame: ViewFrame): ViewFrame {
  return { ...frame, origin: frame.origin.clone(), rotation: frame.rotation.clone() };
}

export function captureFrame(camera: CameraComponent): ViewFrame {
  const controls = cameraControls(camera);
  const origin = controls.focusPoint.clone();
  return { origin, rotation: camera.entity.getRotation().clone(),
    distance: camera.entity.getPosition().distance(origin), fov: camera.fov };
}

export function framePose(frame: ViewFrame): Pose {
  const position = frame.rotation.transformVector(Vec3.BACK, new Vec3())
    .mulScalar(frame.distance).add(frame.origin);
  return new Pose(position, frame.rotation.getEulerAngles(), frame.distance);
}

export function recallFrame(camera: CameraComponent, frame: ViewFrame) {
  const controls = cameraControls(camera);
  camera.fov = frame.fov;
  controls.restorePose(framePose(frame));
}
