import { renderPickView } from "./PickView";
import { viewportPoint } from "../viewports/ViewerViewports";
import { Picker, type AppBase, type CameraComponent, type Vec3 } from "playcanvas";

// Own the engine picker until before its graphics device is destroyed, including if
// navigation interrupts an asynchronous read. Reuse its buffers between clicks.
export class SurfacePicker {
  private picker?: Picker;
  private disposed = false;
  constructor(private readonly app: AppBase, private readonly layers: readonly number[]) { app.on("destroy", this.destroy, this); }
  async pick(camera: CameraComponent, u: number, v: number): Promise<Vec3 | null> {
    if (this.disposed) throw new Error("Viewer closed during measurement.");
    const local = viewportPoint(camera, u, v); u = local.u; v = local.v;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    const device = this.app.graphicsDevice;
    const width = Math.max(1, Math.floor(device.width * camera.rect.z)), height = Math.max(1, Math.floor(device.height * camera.rect.w));
    this.picker ??= new Picker(this.app, width, height, true);
    this.picker.resize(width, height);
    // Annotation hotspots have their own camera layers; only pick model geometry.
    renderPickView(camera, () => this.picker!.prepare(camera, this.app.scene, this.layers.map(id => this.app.scene.layers.getLayerById(id)!)));
    const point = await this.picker.getWorldPointAsync(Math.floor(u * width) + .5, Math.floor(v * height) + .5);
    if (this.disposed) throw new Error("Viewer closed during measurement.");
    return point;
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.app.off("destroy", this.destroy, this);
    this.picker?.destroy();
  }
}
