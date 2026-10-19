import { Color, Entity, Gizmo, RotateGizmo, TransformGizmo, Vec3 } from "playcanvas";
import { cameraControls, type CameraControls } from "../CameraControls";
import type { SelectionHandle } from "../selection/types";

// Native handle geometry, picking and rotation. Only the presentation root
// rotates; the grid is drawn in fixed world coordinates around its pivot.
export class ViewGizmo {
  private readonly reference = new Entity("Asset rotation handle");
  private readonly camera;
  private readonly layer;
  private readonly gizmo;
  private readonly controls: CameraControls;
  private readonly grid: Vec3[] = [];
  private readonly color = new Color(0.35, 0.35, 0.35);
  private controlsEnabled: boolean | null = null;
  private disposed = false;

  constructor(private readonly handle: SelectionHandle) {
    this.camera = handle.camera(); this.controls = cameraControls(this.camera);
    this.layer = Gizmo.createLayer(handle.app);
    handle.app.root.addChild(this.reference);
    this.reference.setPosition(handle.space.pivot); this.syncRotation();
    this.gizmo = new RotateGizmo(this.camera, this.layer);
    this.gizmo.coordSpace = "world";
    this.gizmo.mouseButtons[1] = false; this.gizmo.mouseButtons[2] = false;
    handle.app.graphicsDevice.canvas.addEventListener("pointerdown", this.chooseInput, true);
    handle.app.graphicsDevice.canvas.addEventListener("pointercancel", this.cancel);
    this.gizmo.attach([this.reference]);
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMSTART, () => {
      this.controlsEnabled = this.controls.enabled; this.controls.enabled = false;
    });
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMMOVE, () => handle.space.setRotation(this.reference.getRotation()));
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMEND, () => this.releaseCamera());
    handle.space.on("change", this.syncRotation, this);
    const extent = handle.selection.bounds(null)!.halfExtents.length();
    // Ten subdivisions on either side are display policy, independent of asset scale.
    for (let i = -10; i <= 10; i++) {
      const offset = extent * i / 10, p = handle.space.pivot;
      this.grid.push(new Vec3(p.x - extent, p.y, p.z + offset), new Vec3(p.x + extent, p.y, p.z + offset),
        new Vec3(p.x + offset, p.y, p.z - extent), new Vec3(p.x + offset, p.y, p.z + extent));
    }
    handle.app.on("prerender", this.draw, this); handle.app.on("destroy", this.destroy, this);
  }
  private syncRotation() { this.reference.setRotation(this.handle.space.rotation); }
  private draw() { this.handle.app.drawLines(this.grid, this.color, true); }
  private releaseCamera() {
    if (this.controlsEnabled === null) return;
    this.controls.enabled = this.controlsEnabled; this.controlsEnabled = null;
  }
  private chooseInput = (event: PointerEvent) => { this.gizmo.mouseButtons[0] = !event.altKey; };
  private cancel = () => { if (this.controlsEnabled !== null) this.gizmo.detach(); };
  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.handle.app.graphicsDevice.canvas.removeEventListener("pointerdown", this.chooseInput, true);
    this.handle.app.graphicsDevice.canvas.removeEventListener("pointercancel", this.cancel);
    this.handle.app.off("prerender", this.draw, this); this.handle.app.off("destroy", this.destroy, this);
    this.handle.space.off("change", this.syncRotation, this);
    this.gizmo.destroy(); this.releaseCamera(); this.reference.destroy();
    this.camera.layers = this.camera.layers.filter(id => id !== this.layer.id);
    this.handle.app.scene.layers.remove(this.layer);
  }
}
