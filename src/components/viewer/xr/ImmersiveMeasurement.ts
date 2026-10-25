import { Color, Entity, Layer, Mat4, Picker, StandardMaterial, Vec3, type CameraComponent, type XrInputSource } from "playcanvas";
import type { Measurement } from "../measurement/Measurement";
import type { SelectionHandle, SelectionTool } from "../selection/types";
import { MeasurementPanel } from "./MeasurementPanel";
import { spatialInput } from "./SpatialPanel";

// Input/presentation adapter over the same Measurement document as desktop.
export class ImmersiveMeasurement {
  private readonly ui: MeasurementPanel;
  private readonly releaseInput: () => void;
  private pickEntity: Entity | null = null;
  private readonly pointPreview = new Entity("XR measurement surface preview");
  private readonly previewMaterial = new StandardMaterial();
  private readonly previewLayer = new Layer({ name: "XR measurement preview", clearDepthBuffer: true });
  private previewTask: Promise<void> | null = null;
  private previewAt = 0;
  private readonly previewOrigin = new Vec3(Infinity, Infinity, Infinity);
  private readonly previewDirection = new Vec3();
  private readonly previewTransform = new Mat4();
  private picker: Picker | null = null;
  private pickCamera: CameraComponent | null = null;
  private readonly aim = new Vec3();
  private readonly tapOrigin = new Vec3();
  private readonly endpoint = new Vec3();
  private readonly rayPoint = new Vec3();
  private tapping = false;
  private dragged = false;
  private tool: SelectionTool = "navigate";
  private armed = false;
  private moving: 0 | 1 | null = null;
  private selectedId: number | null = null;
  private name = "";
  private busy = false;
  private disposed = false;
  private revision = 0;
  private message = "";

  constructor(private readonly handle: SelectionHandle, private readonly measurement: () => Measurement,
    private readonly changed: () => void, private readonly ready: () => boolean) {
    const app = handle.app, camera = handle.viewports.perspectivePanel.camera;
    this.releaseInput = spatialInput(app);
    this.ui = new MeasurementPanel(app, camera.entity, {
      tool: active => this.setTool(active ? "measure" : "navigate"),
      open: id => { this.revision++; this.selectedId = id; this.name = this.current()!.name; this.armed = false; this.refresh(); },
      remove: id => { this.revision++; this.measurement().remove(id); if (id === this.selectedId) this.selectedId = null; this.commit(); },
      name: value => { this.name = value; this.refresh(); }, save: () => this.save(),
      clear: () => { this.revision++; this.measurement().clear(); this.selectedId = null; this.armed = true; this.commit(); },
      style: style => { this.measurement().setStyle(style); this.commit(); }
    });
    this.previewMaterial.useLighting = false;
    this.previewMaterial.emissive.copy(Color.WHITE); this.previewMaterial.diffuse.copy(Color.WHITE); this.previewMaterial.update();
    app.scene.layers.push(this.previewLayer);
    camera.layers = [...camera.layers, this.previewLayer.id];
    app.root.addChild(this.pointPreview);
    this.pointPreview.addComponent("render", { type: "sphere", material: this.previewMaterial,
      layers: [this.previewLayer.id], castShadows: false, receiveShadows: false });
    this.pointPreview.setLocalScale(.012, .012, .012); this.pointPreview.enabled = false;
    app.xr!.input.on("selectstart", this.selectStart, this); app.xr!.input.on("selectend", this.selectEnd, this);
    app.xr!.input.on("remove", this.cancelPointer, this);
    app.on("update", this.trackTap, this); app.on("update", this.previewPoint, this);
    this.refresh();
  }
  get isArmed() { return this.tool === "measure" && this.armed; }
  get isMenuTargeted() { return this.ui.targeted; }
  get blocksPan() { return this.ui.targeted || this.moving !== null; }
  get currentTool() { return this.tool; }
  setTool(tool: SelectionTool) {
    this.revision++;
    if (tool !== "measure" && this.tool === "measure" && this.measurement().discardUnsaved()) this.changed();
    this.tool = tool === "measure" ? "measure" : "navigate";
    this.armed = this.tool === "measure"; this.moving = null; this.selectedId = null; this.message = "";
    this.previewOrigin.set(Infinity, Infinity, Infinity); this.refresh();
  }
  open() { this.refresh(); }
  private current() { return this.measurement().records.find(record => record.id === this.selectedId); }
  private save() {
    const record = this.current();
    if (!record || record.points.length !== 2 || !this.name.trim()) return;
    this.measurement().save(record.id, this.name);
    this.selectedId = null; this.armed = true; this.moving = null; this.message = ""; this.commit();
  }
  private commit() { this.changed(); this.refresh(); }

  // A trigger tap places a point. Sustained controller motion is owned by pan,
  // so a pan release cannot also create a measurement.
  private selectStart(source: XrInputSource) {
    if (source.handedness !== "right") return;
    this.tapping = this.tool === "measure" && !this.isMenuTargeted;
    this.dragged = false;
    if (!this.tapping) return;
    this.tapOrigin.copy(source.getPosition() ?? source.getOrigin());
    const record = this.current();
    if (record?.points.length === 2) for (const index of [0, 1] as const) {
      this.handle.space.toWorld(record.points[index]!, this.endpoint);
      this.rayPoint.sub2(this.endpoint, source.getOrigin());
      const distance = this.rayPoint.dot(source.getDirection());
      this.rayPoint.copy(source.getDirection()).mulScalar(distance).add(source.getOrigin());
      if (distance > 0 && this.rayPoint.distance(this.endpoint) < .025) {
        this.moving = index; this.armed = true; break;
      }
    }
  }
  private trackTap() {
    if (!this.tapping || this.dragged) return;
    const right = this.handle.app.xr?.input.inputSources.find(source => source.handedness === "right");
    if (right && this.tapOrigin.distance(right.getPosition() ?? right.getOrigin()) >= .02) this.dragged = true;
  }
  private cancelPointer(source: XrInputSource) {
    if (source.handedness !== "right") return;
    this.revision++; this.moving = null; this.tapping = this.dragged = false;
    this.armed = this.tool === "measure" && this.current()?.points.length !== 2;
  }
  private previewPoint() {
    const source = this.handle.app.xr?.input.inputSources.find(input => input.handedness === "right" && !input.hand);
    if (!this.isArmed || !this.ready() || !source || this.isMenuTargeted ||
      (this.moving === null && (source.selecting || this.dragged))) {
      this.pointPreview.enabled = false; return;
    }
    const origin = source.getOrigin(), direction = source.getDirection();
    const transform = this.handle.space.root.getWorldTransform();
    if (this.busy || this.previewTask || performance.now() - this.previewAt < 120 ||
      (origin.distance(this.previewOrigin) < .005 && direction.distance(this.previewDirection) < .01 &&
        transform.equals(this.previewTransform))) return;
    this.previewAt = performance.now();
    const revision = this.revision;
    this.previewOrigin.copy(origin); this.previewDirection.copy(direction); this.previewTransform.copy(transform);
    this.previewTask = this.pick(source).then(point => {
      if (this.disposed || revision !== this.revision) return;
      if (!this.isArmed || !point || this.isMenuTargeted) {
        this.pointPreview.enabled = false; return;
      }
      // Raise the dot slightly toward the pointer to avoid burying it in the surface.
      const toward = source.getOrigin().clone().sub(point).normalize().mulScalar(.006);
      this.pointPreview.setPosition(point.clone().add(toward));
      this.pointPreview.enabled = true;
    }).catch(() => { if (!this.disposed) this.pointPreview.enabled = false; }).finally(() => { this.previewTask = null; });
  }
  private async selectEnd(source: XrInputSource) {
    if (source.handedness !== "right") return;
    const tapped = this.tapping && !this.dragged && this.tapOrigin.distance(source.getPosition() ?? source.getOrigin()) < .02;
    this.tapping = false; this.dragged = false;
    if ((!tapped && this.moving === null) || !this.isArmed || !this.ready() || this.busy || this.isMenuTargeted) {
      if (this.moving !== null) { this.moving = null; this.armed = false; }
      return;
    }
    if (!source.getOrigin() || !source.getDirection()) return;
    this.busy = true;
    const revision = this.revision;
    this.pointPreview.enabled = false;
    try {
      await this.previewTask;
      if (this.disposed || revision !== this.revision) return;
      const point = await this.pick(source);
      if (this.disposed || revision !== this.revision || !this.isArmed) return;
      if (!point) { this.message = "Aim at a visible surface"; return; }
      const model = this.measurement();
      const local = this.handle.space.toLocal(point);
      if (this.moving !== null) {
        const record = this.current();
        const previous = record?.points[this.moving];
        if (previous && previous.distance(local) < 1e-6) {
          this.message = "Aim at a different surface point"; return;
        }
        if (record) model.moveEndpoint(record.id, this.moving, local);
        this.moving = null; this.armed = false;
      } else {
        const last = model.records.at(-1);
        if (last && !last.saved && last.points.length === 1 && last.points[0]!.distance(local) < 1e-6) {
          this.message = "Aim at a different point B"; return;
        }
        model.add(local, !last || last.saved || last.points.length === 2);
        this.selectedId = model.records.at(-1)?.id ?? null;
        this.name = this.current()?.name ?? "";
        this.armed = model.points.length !== 2;
      }
      this.message = ""; this.changed();
    } catch (error) {
      if (!this.disposed) this.message = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.moving !== null) { this.moving = null; this.armed = false; }
      this.busy = false; if (!this.disposed) this.refresh();
    }
  }

  private async pick(source: XrInputSource) {
    const origin = source.getOrigin(), direction = source.getDirection();
    // CPU-sorted splats have no native Picker depth. The direct center query
    // avoids an offscreen pass or second camera for that renderer path.
    if (this.handle.selection.pickRay) return this.handle.selection.pickRay(origin, direction);
    if (!this.pickCamera) {
      this.pickEntity = new Entity("XR surface pick camera");
      this.handle.app.root.addChild(this.pickEntity);
      this.pickEntity.addComponent("camera", { fov: 1, nearClip: .01, farClip: 100 });
      this.pickCamera = this.pickEntity.camera!;
      this.pickCamera.layers = [...this.handle.selection.layers];
      this.pickCamera.enabled = false;
      this.picker = new Picker(this.handle.app, 64, 64, true);
    }
    this.pickEntity!.setPosition(origin);
    this.pickEntity!.lookAt(this.aim.copy(direction).add(origin));
    const layers = this.handle.selection.layers.map(id => this.handle.app.scene.layers.getLayerById(id)!).filter(Boolean);
    this.pickCamera.enabled = true;
    try {
      this.picker!.prepare(this.pickCamera, this.handle.app.scene, layers);
      return await this.picker!.getWorldPointAsync(32, 32);
    } finally { this.pickCamera.enabled = false; }
  }

  private refresh() {
    const model = this.measurement();
    this.ui.render({ active: this.tool === "measure", records: model.records, selectedId: this.selectedId,
      name: this.name, message: this.message, style: model.style, busy: this.busy });
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    const app = this.handle.app;
    app.xr?.input.off("selectstart", this.selectStart, this); app.xr?.input.off("selectend", this.selectEnd, this);
    app.xr?.input.off("remove", this.cancelPointer, this);
    app.off("update", this.trackTap, this); app.off("update", this.previewPoint, this);
    this.ui.destroy(); this.releaseInput(); this.pickEntity?.destroy(); this.picker?.destroy();
    this.pointPreview.destroy(); this.previewMaterial.destroy(); app.scene.layers.remove(this.previewLayer);
  }
}
