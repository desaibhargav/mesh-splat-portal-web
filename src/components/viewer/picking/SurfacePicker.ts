import { renderPickView } from "./PickView";
import { viewportContains, viewportPoint } from "../viewports/ViewerViewports";
import { Picker, type AppBase, type CameraComponent, type Vec3 } from "playcanvas";

// Own GPU buffers through readback and release before graphics-device teardown.
export class SurfacePicker {
  private picker?: Picker;
  private disposed = false;
  constructor(private readonly app: AppBase, private readonly layers: readonly number[]) { app.on("destroy", this.destroy, this); }
  async pick(camera: CameraComponent, u: number, v: number): Promise<Vec3 | null> {
    if (!viewportContains(camera, u, v)) return null;
    return this.capture(camera)(u, v);
  }
  // Reuse a depth image while the camera/model stay fixed, e.g. an endpoint drag.
  // Callers cancel the gesture when the viewport or scene changes.
  capture(camera: CameraComponent) {
    if (this.disposed) throw new Error("Viewer closed during measurement.");
    const viewport = { rect: camera.rect.clone() }, device = this.app.graphicsDevice;
    const width = Math.max(1, Math.floor(device.width * camera.rect.z)), height = Math.max(1, Math.floor(device.height * camera.rect.w));
    this.picker ??= new Picker(this.app, width, height, true);
    this.picker.resize(width, height);
    // Restrict picks to model layers; overlays and gizmos are not surfaces.
    renderPickView(camera, () => this.picker!.prepare(camera, this.app.scene, this.layers.map(id => this.app.scene.layers.getLayerById(id)!)));
    return async (u: number, v: number): Promise<Vec3 | null> => {
      if (this.disposed) throw new Error("Viewer closed during measurement.");
      const local = viewportPoint(viewport, u, v);
      if (local.u < 0 || local.u >= 1 || local.v < 0 || local.v >= 1) return null;
      const point = await this.picker!.getWorldPointAsync(Math.floor(local.u * width) + .5, Math.floor(local.v * height) + .5);
      if (this.disposed) throw new Error("Viewer closed during measurement.");
      return point;
    };
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.app.off("destroy", this.destroy, this); this.picker?.destroy();
  }
}
