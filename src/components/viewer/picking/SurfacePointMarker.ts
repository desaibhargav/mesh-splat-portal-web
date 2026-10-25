import { Color, Entity, Layer, PROJECTION_ORTHOGRAPHIC, StandardMaterial, Vec3, type CameraComponent } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { measurementAppearance } from "../measurement/measurementAppearance";

// One surface-anchored scene visual for desktop and XR, with no pick pass of
// its own. Keep the local hit so every presentation transform moves it with the asset.
export class SurfacePointMarker {
  readonly entity = new Entity("Surface point preview");
  private readonly layer = new Layer({ name: "Surface point preview" });
  private readonly material = new StandardMaterial();
  private readonly local = new Vec3();
  private readonly world = new Vec3();
  private readonly delta = new Vec3();
  private readonly releaseLayer: () => void;
  private camera: CameraComponent;
  private readonly pixels: number;
  private disposed = false;
  constructor(private readonly handle: SelectionHandle) {
    this.camera = handle.camera();
    this.pixels = measurementAppearance(handle.app).markerSize;
    this.material.useLighting = this.material.useFog = this.material.useTonemap = false;
    this.material.useSkybox = false;
    this.material.depthTest = this.material.depthWrite = false;
    this.material.diffuse.copy(Color.WHITE); this.material.emissive.copy(Color.WHITE); this.material.update();
    handle.app.scene.layers.push(this.layer); this.releaseLayer = handle.viewports.shareLayer(this.layer.id);
    handle.app.root.addChild(this.entity);
    this.entity.addComponent("render", { type: "sphere", material: this.material, layers: [this.layer.id], castShadows: false, receiveShadows: false });
    this.entity.enabled = false;
    handle.app.on("prerender", this.update, this);
    handle.app.on("destroy", this.destroy, this);
  }
  set(point: Vec3 | null, camera = this.handle.camera()) {
    if (this.disposed) return;
    this.entity.enabled = !!point; this.camera = camera;
    if (point) { this.local.copy(point); this.update(); }
  }
  private update() {
    if (!this.entity.enabled) return;
    this.handle.space.toWorld(this.local, this.world); this.entity.setPosition(this.world);
    const depth = this.delta.sub2(this.world, this.camera.entity.getPosition()).dot(this.camera.entity.forward);
    const size = this.handle.app.xr?.active ? .012 : this.pixels * 2 * (this.camera.projection === PROJECTION_ORTHOGRAPHIC ? 1 : depth) /
      (this.camera.projectionMatrix.data[5]! * this.handle.app.graphicsDevice.clientRect.height * this.camera.rect.w);
    this.entity.setLocalScale(size, size, size);
  }
  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.handle.app.off("prerender", this.update, this);
    this.handle.app.off("destroy", this.destroy, this);
    this.releaseLayer(); this.entity.destroy(); this.material.destroy(); this.handle.app.scene.layers.remove(this.layer);
  }
}
