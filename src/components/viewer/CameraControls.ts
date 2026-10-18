import { Pose, Vec3, type CameraComponent } from "playcanvas";
import { CameraControls as EngineCameraControls } from "playcanvas/scripts/esm/camera-controls.mjs";

// The bundled 2.21.4 reset/focus APIs call Pose.look(), which discards roll.
// Restore its own pose and orbit controller together, rather than fighting
// camera transforms each frame. Review this boundary when upgrading the script.
export class CameraControls extends EngineCameraControls {
  static override get scriptName() { return "cameraControls"; }

  restorePose(pose: Pose) {
    this.entity.setPosition(pose.position);
    this.focusPoint = pose.getFocus(new Vec3());
    this._pose.copy(pose);
    this._controller.attach(this._pose, false);
    this.entity.setEulerAngles(pose.angles);
  }
}

export function cameraControls(camera: CameraComponent): CameraControls {
  return camera.entity.script!.get("cameraControls") as unknown as CameraControls;
}
