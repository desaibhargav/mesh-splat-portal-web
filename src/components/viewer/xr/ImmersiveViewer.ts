import { Entity, EventHandler, PROJECTION_PERSPECTIVE, Quat, Vec3, XRTYPE_AR, XRTYPE_VR, XRSPACE_LOCALFLOOR } from "playcanvas";
import { cameraControls } from "../CameraControls";
import { captureFrame, recallFrame } from "../views/viewFrame";
import type { SelectionHandle } from "../selection/types";

// Presentation policy in metres, independent of uncalibrated source units.
const displaySize = 1;
const viewingDistance = 1.5;
type ImmersiveType = typeof XRTYPE_AR | typeof XRTYPE_VR;

export class ImmersiveViewer extends EventHandler {
  revision = 0;
  pending = false;
  active = false;
  error: string | null = null;
  private disposed = false;
  private restore: (() => void) | null = null;
  private readonly camera;
  private readonly xr;

  constructor(private readonly handle: SelectionHandle) {
    super();
    this.camera = handle.viewports.perspectivePanel.camera;
    this.xr = handle.app.xr;
    this.xr?.on("available", this.changed, this);
    this.xr?.on("start", this.entered, this);
    this.xr?.on("end", this.ended, this);
    handle.app.on("destroy", this.destroy, this);
  }

  available(type: ImmersiveType) { return this.xr?.isAvailable(type) ?? false; }

  start(type: ImmersiveType) {
    if (!this.xr || this.disposed || this.pending || this.active || !this.available(type)) return;
    const { app, selection } = this.handle, camera = this.camera, xr = this.xr;
    const bounds = selection.bounds(null);
    if (!bounds || bounds.halfExtents.length() === 0) {
      this.error = "The asset has no visible bounds to display."; this.changed(); return;
    }
    const parent = camera.entity.parent!, frame = captureFrame(camera);
    const scale = camera.entity.getLocalScale().clone(), enabled = cameraControls(camera).enabled;
    const clearColor = camera.clearColor.clone(), near = camera.nearClip, far = camera.farClip;
    const width = app.graphicsDevice.width, height = app.graphicsDevice.height;
    const rig = new Entity("Immersive viewing space");
    const unitsPerMetre = Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z) * 2 / displaySize;
    app.root.addChild(rig); rig.setLocalScale(unitsPerMetre, unitsPerMetre, unitsPerMetre);
    const place = () => {
      // The first tracked pose defines the placement once. Later head movement
      // moves through the scene naturally; the artifact never follows the head.
      const forward = camera.entity.getLocalRotation().transformVector(Vec3.FORWARD);
      forward.y = 0;
      if (!forward.lengthSq()) forward.copy(Vec3.FORWARD);
      forward.normalize();
      const yaw = Math.atan2(-forward.x, -forward.z) * 180 / Math.PI;
      const rotation = new Quat().setFromEulerAngles(0, -yaw, 0);
      rig.setRotation(rotation);
      const placement = camera.entity.getLocalPosition().clone().add(forward.mulScalar(viewingDistance));
      rig.setPosition(bounds.center.clone().sub(rotation.transformVector(placement).mulScalar(unitsPerMetre)));
    };
    this.restore = () => {
      xr.off("update", place);
      parent.addChild(camera.entity); camera.entity.setLocalScale(scale);
      camera.nearClip = near; camera.farClip = far; camera.clearColor = clearColor;
      recallFrame(camera, frame); cameraControls(camera).enabled = enabled;
      app.renderNextFrame = true;
      app.graphicsDevice.setResolution(width, height);
      rig.destroy();
    };
    // WebXR owns the camera's local pose; PlayCanvas composes this parent into
    // both eye views. Geometry, clipping planes and saved coordinates stay intact.
    rig.addChild(camera.entity); camera.entity.setLocalScale(1, 1, 1);
    camera.entity.setLocalPosition(0, 0, 0); camera.entity.setLocalRotation(Quat.IDENTITY);
    camera.projection = PROJECTION_PERSPECTIVE;
    camera.nearClip = .01; camera.farClip = 100;
    if (type === XRTYPE_AR) camera.clearColor = clearColor.clone().set(0, 0, 0, 0);
    xr.once("update", place);
    this.pending = true; this.error = null; this.changed();
    try {
      xr.start(camera, type, XRSPACE_LOCALFLOOR, { callback: error => {
        if (error) { this.error = error.message; this.ended(); }
        else if (this.disposed) xr.end();
      } });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error); this.ended();
    }
  }

  end() { if (this.active) this.xr?.end(); }
  private entered() {
    if (this.disposed) { this.xr?.end(); return; }
    cameraControls(this.camera).enabled = false;
    this.active = true; this.pending = false; this.changed();
  }
  private ended() {
    this.restore?.(); this.restore = null;
    this.active = false; this.pending = false; this.changed();
  }
  private changed() { this.revision++; this.fire("change"); }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    const { app } = this.handle;
    this.xr?.off("available", this.changed, this); this.xr?.off("start", this.entered, this); this.xr?.off("end", this.ended, this);
    app.off("destroy", this.destroy, this);
    if (this.active) this.xr?.end();
    this.ended(); this.off();
  }
}
