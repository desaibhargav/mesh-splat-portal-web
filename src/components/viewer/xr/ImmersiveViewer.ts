import { Color, Entity, EventHandler, PROJECTION_PERSPECTIVE, Quat, XRTYPE_AR, XRTYPE_VR, XRSPACE_LOCALFLOOR } from "playcanvas";
import { cameraControls } from "../CameraControls";
import { captureFrame, recallFrame } from "../views/viewFrame";
import type { SelectionHandle, SelectionTool } from "../selection/types";
import type { SegmentWorkspaces } from "../segments/SegmentWorkspaces";

import { ImmersiveScene } from "./ImmersiveScene";
import { ImmersiveInput } from "./ImmersiveInput";
import { ImmersivePlacement } from "./ImmersivePlacement";
import { ImmersiveGestures } from "./ImmersiveGestures";
import { ImmersiveTools } from "./ImmersiveTools";
import { measurementAppearance } from "../measurement/measurementAppearance";
import { SplatSelection } from "../selection/SplatSelection";
type ImmersiveType = typeof XRTYPE_AR | typeof XRTYPE_VR;

export class ImmersiveViewer extends EventHandler {
  revision = 0;
  pending = false;
  active = false;
  error: string | null = null;
  private disposed = false;
  private exitPressed = false;
  private framePressed = false;
  private undoPressed = false;
  private redoPressed = false;
  private lastReset = 0;
  private activeScene: ImmersiveScene | null = null;
  private restore: (() => void) | null = null;
  private readonly camera;
  private readonly xr;
  private toolMenu: ImmersiveTools | null = null;

  constructor(private readonly handle: SelectionHandle, private readonly workspaces: SegmentWorkspaces,
    private tool: SelectionTool, private readonly changeTool: (tool: SelectionTool) => void) {
    super();
    this.camera = handle.viewports.perspectivePanel.camera;
    this.xr = handle.app.xr;
    this.xr?.on("available", this.changed, this);
    this.xr?.on("start", this.entered, this);
    this.xr?.on("end", this.ended, this);
    handle.app.on("destroy", this.destroy, this);
  }

  available(type: ImmersiveType) { return this.xr?.isAvailable(type) ?? false; }
  private get isSplat() { return this.handle.selection instanceof SplatSelection; }

  setTool(tool: SelectionTool) {
    this.tool = tool;
    this.toolMenu?.setTool(tool);
  }

  start(type: ImmersiveType) {
    if (!this.xr || this.disposed || this.pending || this.active || !this.available(type)) return;
    const { app, selection } = this.handle, camera = this.camera, xr = this.xr;
    measurementAppearance(app);
    const bounds = selection.bounds(null);
    if (!bounds || bounds.halfExtents.length() === 0) {
      this.error = "The asset has no visible bounds to display."; this.changed(); return;
    }
    const parent = camera.entity.parent!, frame = captureFrame(camera);
    const scale = camera.entity.getLocalScale().clone(), enabled = cameraControls(camera).enabled;
    const clearColor = camera.clearColor.clone(), near = camera.nearClip, far = camera.farClip;
    const cameraLayers = [...camera.layers];
    const width = app.graphicsDevice.width, height = app.graphicsDevice.height;
    const ambient = app.scene.ambientLight.clone();
    const radialSorting = app.scene.gsplat.radialSorting;
    const rig = new Entity("Immersive viewing space");
    app.root.addChild(rig);
    if (this.isSplat) {
      // Splat scenes have no lights, but tracked controller models use lit glTF
      // materials. Light the models instead of disabling their material lighting.
      app.scene.ambientLight = new Color(.45, .45, .45);
      const controllerLight = new Entity("XR controller light");
      controllerLight.addComponent("light", { type: "directional", intensity: 1, castShadows: false });
      controllerLight.setEulerAngles(35, -25, 0);
      rig.addChild(controllerLight);
    }
    // Keep the source-space bounds fixed while the asset is reparented and
    // manipulated in XR; SelectionHandle.bounds() reflects its live transform.
    const scene = new ImmersiveScene(this.handle, bounds.clone());
    this.activeScene = scene;
    const input = new ImmersiveInput(app, rig, scene.root, this.handle);
    const placement = type === XRTYPE_AR ? new ImmersivePlacement(app, scene, camera.entity) : null;
    const menu = new ImmersiveTools(this.handle, () => this.workspaces.current.measurement,
      () => this.workspaces.fire("change"), () => !placement || placement.placed, input, this.workspaces);
    this.toolMenu = menu;
    const gestures = new ImmersiveGestures(app, camera.entity, scene, () => !placement || placement.placed,
      () => menu.blocksPan, () => menu.isArmed);
    const place = () => { if (type === XRTYPE_VR) scene.place(camera.entity); };
    this.restore = () => {
      xr.off("update", place);
      app.scene.gsplat.radialSorting = radialSorting;
      parent.addChild(camera.entity); camera.entity.setLocalScale(scale);
      camera.nearClip = near; camera.farClip = far; camera.clearColor = clearColor; camera.layers = cameraLayers;
      recallFrame(camera, frame); cameraControls(camera).enabled = enabled;
      app.renderNextFrame = true;
      app.graphicsDevice.setResolution(width, height);
      gestures.destroy(); menu.destroy(); this.toolMenu = null;
      placement?.destroy(); input.destroy(); scene.destroy(); rig.destroy(); this.activeScene = null;
      app.scene.ambientLight = ambient;
    };
    // Keep tracked poses and controller models in metres; only the artifact
    // presentation is normalized. Source geometry and records stay untouched.
    rig.addChild(camera.entity); camera.entity.setLocalScale(1, 1, 1);
    camera.entity.setLocalPosition(0, 0, 0); camera.entity.setLocalRotation(Quat.IDENTITY);
    camera.projection = PROJECTION_PERSPECTIVE;
    const uiLayer = app.scene.layers.getLayerByName("UI")?.id;
    if (uiLayer !== undefined) camera.layers = [...new Set([...camera.layers, uiLayer])];
    camera.nearClip = .01; camera.farClip = 100;
    // Native distance sorting avoids re-sorting every Gaussian just because the
    // headset turns. Translation and artifact changes still trigger sorting.
    if (this.isSplat) app.scene.gsplat.radialSorting = true;
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
    const left = this.xr?.input.inputSources.find(source => source.handedness === "left" && !source.hand);
    const gamepadLeft = left?.gamepad;
    const undo = gamepadLeft?.mapping === "xr-standard" && !!gamepadLeft.buttons[4]?.pressed;
    const redo = gamepadLeft?.mapping === "xr-standard" && !!gamepadLeft.buttons[5]?.pressed;
    if (undo && !this.undoPressed) this.toolMenu?.undo();
    if (redo && !this.redoPressed) this.toolMenu?.redo();
    this.undoPressed = undo; this.redoPressed = redo;
    const frame = !!left?.selecting && !!right?.selecting;
    if (frame && !this.framePressed) { this.toolMenu?.frameChord(); this.activeScene?.frame(this.camera.entity); }
    this.framePressed = frame;
    const gamepad = right?.gamepad;
    const pressed = gamepad?.mapping === "xr-standard" && !!gamepad.buttons[5]?.pressed;
    const newlyPressed = pressed && !this.exitPressed;
    this.exitPressed = pressed;
    if (newlyPressed) {
      const now = performance.now();
      if (now - this.lastReset < 3000) this.end();
      else { this.activeScene?.reset(); this.lastReset = now; }
    }
  }
  private entered() {
    if (this.disposed) { this.xr?.end(); return; }
    cameraControls(this.camera).enabled = false;
    this.exitPressed = false;
    this.framePressed = this.undoPressed = this.redoPressed = false; this.lastReset = 0;
    this.handle.app.on("update", this.controllerExit, this);
    this.active = true; this.pending = false; this.changed();
    this.toolMenu?.open();
  }
  private ended() {
    this.handle.app.off("update", this.controllerExit, this);
    this.exitPressed = false;
    this.framePressed = this.undoPressed = this.redoPressed = false; this.lastReset = 0;
    const tool = this.toolMenu?.currentTool;
    this.restore?.(); this.restore = null;
    this.active = false; this.pending = false; this.changed();
    // Sync the menu choice after leaving PlayCanvas's XR update. React panel
    // transitions during the headset session can interrupt that update.
    if (tool && tool !== this.tool && !this.disposed) setTimeout(() => {
      if (!this.disposed && !this.active) this.changeTool(tool);
    }, 0);
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
