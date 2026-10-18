declare module "playcanvas/scripts/esm/camera-controls.mjs" {
  import { Script, Vec2, Vec3 } from "playcanvas";

  export class CameraControls extends Script {
    focusPoint: Vec3;
    zoomRange: Vec2;
  }
}
