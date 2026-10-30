import { Entity, EventHandler, PROJECTION_ORTHOGRAPHIC, PROJECTION_PERSPECTIVE, Vec3, Vec4, type AppBase, type BoundingBox, type CameraComponent } from "playcanvas";
import { CameraControls, cameraControls } from "../CameraControls";
import { captureFrame, directionFrame, recallFrame, type ViewFrame } from "../views/viewFrame";
import { focusSelection } from "../selection/focusSelection";

export interface Viewport { id: string; label: string; camera: CameraComponent }
export function viewportContains(camera: CameraComponent, u: number, v: number) {
  const r = camera.rect;
  return u >= r.x && u < r.x + r.z && v >= 1 - r.y - r.w && v < 1 - r.y;
}
export function viewportPoint(camera: Pick<CameraComponent, "rect">, u: number, v: number) {
  const r = camera.rect;
  return { u: (u - r.x) / r.z, v: (v - (1 - r.y - r.w)) / r.w };
}

function inspectionFrame(camera: CameraComponent, normal: Vec3) {
  const frame = directionFrame(captureFrame(camera), normal);
  frame.orthoHeight = camera.projection === PROJECTION_ORTHOGRAPHIC ? camera.orthoHeight : frame.distance / camera.projectionMatrix.data[5]!;
  frame.projection = PROJECTION_ORTHOGRAPHIC;
  return frame;
}

// One scene and shared editing state. Cameras own only viewpoint and navigation.
export class ViewerViewports extends EventHandler {
  readonly panels: Viewport[];
  revision = 0;
  split = false;
  active: Viewport;
  private readonly sharedLayers = new Set<number>();
  private readonly baseLayers: number[];
  private disposed = false;
  private beforeXR: { split: boolean; active: Viewport } | null = null;
  constructor(private readonly app: AppBase, private readonly primary: CameraComponent) {
    super(); this.baseLayers = [...primary.layers];
    this.active = { id: "perspective", label: "Perspective", camera: primary };
    this.panels = [this.active];
    app.on("destroy", this.destroy, this);
    app.xr?.on("start", this.enterXR, this); app.xr?.on("end", this.leaveXR, this);
  }
  get visible() { return this.split ? this.panels : [this.active]; }
  get perspectivePanel() { return this.panels.find(panel => panel.id === "perspective") ?? this.active; }
  activate(panel: Viewport) {
    if (this.active === panel || (this.app.xr?.camera && panel.camera.entity !== this.app.xr.camera)) return;
    cameraControls(this.active.camera).enabled = false;
    this.active = panel; cameraControls(panel.camera).enabled = true;
    this.changed();
  }
  at(u: number, v: number) { return this.visible.find(panel => viewportContains(panel.camera, u, v)); }
  toggle() {
    if (this.app.xr?.active) return;
    if (this.panels.length === 1) this.createPanels();
    this.split = !this.split; this.layout();
  }
  private layout() {
    for (const [index, panel] of this.panels.entries()) {
      const camera = panel.camera;
      camera.enabled = this.split || panel === this.active;
      camera.rect = this.split ? new Vec4(index % 2 / 2, index < 2 ? .5 : 0, .5, .5) : new Vec4(0, 0, 1, 1);
      camera.scissorRect = camera.rect.clone();
    }
    this.changed();
  }
  private enterXR() {
    const panel = this.panels.find(panel => panel.camera.entity === this.app.xr!.camera);
    if (!panel) return;
    this.beforeXR = { split: this.split, active: this.active };
    this.activate(panel); this.split = false; this.layout();
  }
  private leaveXR() {
    // Restore desktop navigation after native end processing releases the XR camera.
    queueMicrotask(() => {
      if (this.disposed || !this.beforeXR) return;
      const previous = this.beforeXR; this.beforeXR = null;
      this.activate(previous.active); this.split = previous.split; this.layout();
    });
  }
  shareLayer(id: number) {
    this.sharedLayers.add(id);
    for (const panel of this.panels) panel.camera.layers = [...panel.camera.layers, id];
    return () => {
      this.sharedLayers.delete(id);
      for (const panel of this.panels) panel.camera.layers = panel.camera.layers.filter(value => value !== id);
    };
  }
  align(panel: Viewport, normal: Vec3, label: string) {
    const frame = inspectionFrame(panel.camera, normal);
    recallFrame(panel.camera, frame); panel.label = label; this.changed();
  }
  perspective(panel: Viewport) {
    panel.camera.projection = PROJECTION_PERSPECTIVE; panel.label = "Perspective"; this.changed();
  }
  focus(bounds: BoundingBox) {
    for (const panel of this.visible) focusSelection(bounds, panel.camera);
    this.changed();
  }
  restore(frame: ViewFrame) {
    for (const panel of this.visible) {
      if (!this.split || panel.id === "perspective") recallFrame(panel.camera, frame);
      else {
        const current = captureFrame(panel.camera);
        current.origin.copy(frame.origin); current.distance = frame.distance;
        current.orthoHeight = frame.orthoHeight ?? frame.distance / panel.camera.projectionMatrix.data[5]!;
        recallFrame(panel.camera, current);
      }
    }
    this.changed();
  }
  restorePerspective(frame: ViewFrame) {
    recallFrame(this.split ? this.perspectivePanel.camera : this.active.camera, frame); this.changed();
  }
  refresh() { this.changed(); }
  private createPanels() {
    const primary = this.active.camera;
    const definitions = [{ id: "top", label: "Top", normal: Vec3.UP },
      { id: "front", label: "Front", normal: Vec3.FORWARD }, { id: "right", label: "Right", normal: Vec3.RIGHT }];
    const panels = definitions.map(({ id, label, normal }, index) => {
      const entity = new Entity(`${label} viewport`);
      primary.system.cloneComponent(primary.entity, entity); entity.addComponent("script");
      this.app.root.addChild(entity);
      const camera = entity.camera!;
      camera.layers = [...this.baseLayers, ...this.sharedLayers]; camera.priority = primary.priority + index + 1;
      const source = cameraControls(primary);
      const controls = entity.script!.create(CameraControls, { properties: {
        enableFly: source.enableFly, focusDamping: source.focusDamping, moveDamping: source.moveDamping,
        rotateDamping: source.rotateDamping, zoomDamping: source.zoomDamping
      } }) as unknown as CameraControls;
      controls.zoomRange = source.zoomRange.clone();
      const frame = inspectionFrame(primary, normal);
      recallFrame(camera, frame); controls.enabled = false;
      return { id, label, camera };
    });
    this.panels.splice(0, 0, ...panels);
  }
  private changed() { this.revision++; this.fire("change"); }
  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.app.off("destroy", this.destroy, this);
    this.app.xr?.off("start", this.enterXR, this); this.app.xr?.off("end", this.leaveXR, this);
    for (const panel of this.panels) if (panel.camera !== this.primary) panel.camera.entity.destroy();
    this.off();
  }
}
