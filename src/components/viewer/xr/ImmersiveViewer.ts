import { Entity, EventHandler, PROJECTION_PERSPECTIVE, Quat, XRTYPE_AR, XRTYPE_VR, XRSPACE_LOCALFLOOR } from "playcanvas";
import { cameraControls } from "../CameraControls";
import { captureFrame, recallFrame } from "../views/viewFrame";
import type { SelectionHandle } from "../selection/types";

import { ImmersiveScene } from "./ImmersiveScene";
import { ImmersiveInput } from "./ImmersiveInput";
import { ImmersivePlacement } from "./ImmersivePlacement";
import { ImmersiveGestures } from "./ImmersiveGestures";
type ImmersiveType = typeof XRTYPE_AR | typeof XRTYPE_VR;

export class ImmersiveViewer extends EventHandler {
  revision = 0;
  pending = false;
  active = false;
  error: string | null = null;
  private disposed = false;
  private exitPressed = false;
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
    app.root.addChild(rig);
    const scene = new ImmersiveScene(this.handle, bounds);
    const input = new ImmersiveInput(app, rig, scene.root);
    const placement = type === XRTYPE_AR ? new ImmersivePlacement(app, scene, camera.entity) : null;
    const gestures = new ImmersiveGestures(app, camera.entity, scene, () => !placement || placement.placed);
    const place = () => { if (type === XRTYPE_VR) scene.place(camera.entity); };
    this.restore = () => {
      xr.off("update", place);
      parent.addChild(camera.entity); camera.entity.setLocalScale(scale);
      camera.nearClip = near; camera.farClip = far; camera.clearColor = clearColor;
      recallFrame(camera, frame); cameraControls(camera).enabled = enabled;
      app.renderNextFrame = true;
      app.graphicsDevice.setResolution(width, height);
      gestures.destroy(); placement?.destroy(); input.destroy(); scene.destroy(); rig.destroy();
    };
    // Keep tracked poses and controller models in metres; only the artifact
    // presentation is normalized. Source geometry and records stay untouched.
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
  private controllerExit() {
    const right = this.xr?.input.inputSources.find(source => source.handedness === "right" && !source.hand);
    const gamepad = right?.gamepad;
    const pressed = gamepad?.mapping === "xr-standard" && !!gamepad.buttons[5]?.pressed;
    const newlyPressed = pressed && !this.exitPressed;
    this.exitPressed = pressed;
    if (newlyPressed) this.end();
  }
  private entered() {
    if (this.disposed) { this.xr?.end(); return; }
    cameraControls(this.camera).enabled = false;
    this.exitPressed = false;
    this.handle.app.on("update", this.controllerExit, this);
    this.active = true; this.pending = false; this.changed();
  }
  private ended() {
    this.handle.app.off("update", this.controllerExit, this);
    this.exitPressed = false;
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
