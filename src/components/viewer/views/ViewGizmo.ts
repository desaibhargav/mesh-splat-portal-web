import { Color, Entity, Gizmo, RotateGizmo, TransformGizmo, TranslateGizmo, Vec3 } from "playcanvas";
import { cameraControls, type CameraControls } from "../CameraControls";
import type { SelectionHandle } from "../selection/types";
import { copyFrame, type ViewFrame } from "./viewFrame";

export type ViewTransform = "move" | "rotate";

// Only the helper is attached: handle geometry, picking, and manipulation are
// PlayCanvas's. No per-model traversal or duplicate asset geometry is needed.
export class ViewGizmo {
  private readonly reference = new Entity("View reference");
  private readonly camera;
  private readonly layer;
  private readonly gizmo;
  private readonly controls: CameraControls;
  private readonly guide: Vec3[];
  private readonly worldGuide: Vec3[];
  private readonly color = new Color(1, 1, 1);
  private controlsEnabled: boolean | null = null;
  private disposed = false;

  constructor(private readonly handle: SelectionHandle, frame: ViewFrame,
    mode: ViewTransform, onChange: (frame: ViewFrame) => void) {
    this.camera = handle.camera();
    this.controls = cameraControls(this.camera);
    this.layer = Gizmo.createLayer(handle.app);
    handle.app.root.addChild(this.reference);
    this.reference.setPosition(frame.origin); this.reference.setRotation(frame.rotation);
    this.gizmo = mode === "move" ? new TranslateGizmo(this.camera, this.layer) : new RotateGizmo(this.camera, this.layer);
    this.gizmo.coordSpace = "local";
    this.gizmo.mouseButtons[1] = false; this.gizmo.mouseButtons[2] = false;
    handle.app.graphicsDevice.canvas.addEventListener("pointerdown", this.chooseInput, true);
    handle.app.graphicsDevice.canvas.addEventListener("pointercancel", this.cancel);
    this.gizmo.attach([this.reference]);
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMSTART, () => {
      this.controlsEnabled = this.controls.enabled;
      this.controls.enabled = false;
    });
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMEND, () => {
      this.releaseCamera();
      const edited = copyFrame(frame);
      edited.origin.copy(this.reference.getPosition()); edited.rotation.copy(this.reference.getRotation());
      onChange(edited);
    });
    // Half the view's vertical span leaves the plane guide visible around it.
    const extent = frame.distance * Math.tan(frame.fov * Math.PI / 360) / 2;
    this.guide = [new Vec3(-1, -1, 0), new Vec3(1, -1, 0), new Vec3(1, -1, 0), new Vec3(1, 1, 0),
      new Vec3(1, 1, 0), new Vec3(-1, 1, 0), new Vec3(-1, 1, 0), new Vec3(-1, -1, 0),
      new Vec3(), new Vec3(0, 0, 1)].map(point => point.mulScalar(extent));
    this.worldGuide = this.guide.map(() => new Vec3());
    handle.app.on("prerender", this.draw, this);
    handle.app.on("destroy", this.destroy, this);
  }

  private draw() {
    const transform = this.reference.getWorldTransform();
    this.guide.forEach((point, index) => transform.transformPoint(point, this.worldGuide[index]!));
    this.handle.app.drawLines(this.worldGuide, this.color, false, this.layer);
  }

  private releaseCamera() {
    if (this.controlsEnabled === null) return;
    this.controls.enabled = this.controlsEnabled; this.controlsEnabled = null;
  }

  private chooseInput = (event: PointerEvent) => { this.gizmo.mouseButtons[0] = !event.altKey; };
  private cancel = () => {
    // Native detach ends an interrupted drag and releases its camera ownership.
    if (this.controlsEnabled !== null) this.gizmo.detach();
  };

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.handle.app.graphicsDevice.canvas.removeEventListener("pointerdown", this.chooseInput, true);
    this.handle.app.graphicsDevice.canvas.removeEventListener("pointercancel", this.cancel);
    this.handle.app.off("prerender", this.draw, this); this.handle.app.off("destroy", this.destroy, this);
    this.gizmo.off(TransformGizmo.EVENT_TRANSFORMEND);
    this.gizmo.destroy(); this.releaseCamera(); this.reference.destroy();
    this.camera.layers = this.camera.layers.filter(id => id !== this.layer.id);
    this.handle.app.scene.layers.remove(this.layer);
  }
}
