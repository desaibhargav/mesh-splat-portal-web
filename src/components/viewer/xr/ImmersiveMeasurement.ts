import { Asset, CanvasFont, Color, Entity, Layer, Mat4, Picker, StandardMaterial, Vec2, Vec3, type AppBase, type CameraComponent, type XrInputSource } from "playcanvas";
import { XrMenu } from "playcanvas/scripts/esm/xr/xr-menu.mjs";
import type { Measurement } from "../measurement/Measurement";
import type { SelectionHandle, SelectionTool } from "../selection/types";

const events = {
  navigate: "portal:xr:navigate", measure: "portal:xr:measure", pick: "portal:xr:pick",
  save: "portal:xr:save-measurement", cancel: "portal:xr:cancel-measurement",
  previous: "portal:xr:previous-measurement", moveA: "portal:xr:move-measurement-a",
  moveB: "portal:xr:move-measurement-b"
} as const;

// This is an input adapter, not a second measurement document. Desktop and XR
// write the same local-space Measurement records and use the same renderer.
export class ImmersiveMeasurement {
  private readonly menuHost: Entity;
  private pickEntity: Entity | null = null;
  private readonly font: CanvasFont;
  private readonly fontAsset: Asset;
  private readonly menu: XrMenu;
  private readonly pointPreview = new Entity("XR measurement surface preview");
  private readonly previewMaterial = new StandardMaterial();
  private readonly previewLayer = new Layer({ name: "XR measurement preview", clearDepthBuffer: true });
  private previewBusy = false;
  private previewAt = 0;
  private readonly previewOrigin = new Vec3(Infinity, Infinity, Infinity);
  private readonly previewDirection = new Vec3();
  private readonly previewTransform = new Mat4();
  private picker: Picker | null = null;
  private pickCamera: CameraComponent | null = null;
  private readonly aim = new Vec3();
  private readonly tapOrigin = new Vec3();
  private tapping = false;
  private dragged = false;
  private skipNextRelease = false;
  private tool: SelectionTool;
  private armed = false;
  private moving: 0 | 1 | null = null;
  private selectedId: number | null = null;
  private busy = false;
  private disposed = false;
  private message = "Choose a tool";

  constructor(private readonly handle: SelectionHandle, private readonly measurement: () => Measurement,
    tool: SelectionTool,
    private readonly changed: () => void, private readonly ready: () => boolean) {
    const app = handle.app;
    this.tool = tool;
    this.armed = tool === "measure";
    this.menuHost = handle.viewports.perspectivePanel.camera.entity;
    this.font = new CanvasFont(app, { fontName: "Arial", fontSize: 32 });
    this.font.createTextures("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:-…/()●|");
    this.fontAsset = new Asset("XR tool font", "font");
    this.fontAsset.resource = this.font;
    app.assets.add(this.fontAsset);
    this.menuHost.script ?? this.menuHost.addComponent("script");
    this.menu = this.menuHost.script!.create(XrMenu, { properties: {
      fontAsset: this.fontAsset, preferredHand: "left", alwaysVisible: true,
      buttonWidth: .3, buttonHeight: .042, fontSize: 18,
      followDistance: .8, followOffset: new Vec2(.25, -.08),
      menuItems: [
        { label: "Navigate", eventName: events.navigate },
        { label: "Measure distance", eventName: events.measure },
        { label: "X Frame  |  B Reset / Exit" },
        { label: this.message },
        { label: "Place points", eventName: events.pick },
        { label: "Save measurement", eventName: events.save },
        { label: "Cancel draft", eventName: events.cancel },
        { label: "Saved measurement", eventName: events.previous },
        { label: "Move point A", eventName: events.moveA },
        { label: "Move point B", eventName: events.moveB }
      ]
    } }) as unknown as XrMenu;
    this.previewMaterial.useLighting = false;
    this.previewMaterial.emissive.copy(Color.WHITE);
    this.previewMaterial.diffuse.copy(Color.WHITE);
    this.previewMaterial.update();
    app.scene.layers.push(this.previewLayer);
    this.menuHost.camera!.layers = [...this.menuHost.camera!.layers, this.previewLayer.id];
    app.root.addChild(this.pointPreview);
    this.pointPreview.addComponent("render", { type: "sphere", material: this.previewMaterial,
      layers: [this.previewLayer.id], castShadows: false, receiveShadows: false });
    this.pointPreview.setLocalScale(.012, .012, .012);
    this.pointPreview.enabled = false;
    app.on(events.navigate, this.navigate, this);
    app.on(events.measure, this.measureTool, this);
    app.on(events.pick, this.arm, this);
    app.on(events.save, this.save, this);
    app.on(events.cancel, this.cancel, this);
    app.on(events.previous, this.previous, this);
    app.on(events.moveA, this.moveA, this);
    app.on(events.moveB, this.moveB, this);
    app.xr!.input.on("selectstart", this.selectStart, this);
    app.xr!.input.on("selectend", this.selectEnd, this);
    app.on("update", this.trackTap, this);
    app.on("update", this.previewPoint, this);
    this.refresh();
  }

  get isArmed() { return this.tool === "measure" && this.armed; }
  get isMenuTargeted() { return this.menu.isPointerOverMenu; }
  get currentTool() { return this.tool; }

  setTool(tool: SelectionTool) {
    if (this.tool === tool) return;
    this.tool = tool; this.armed = tool === "measure"; this.moving = null; this.skipNextRelease = false;
    this.open();
    this.refresh();
  }

  open() {
    // Keep the tool bar in view while navigating and while placing points.
    // A hidden menu made the first XR tool undiscoverable on the headset.
    this.menu.alwaysVisible = true;
    this.menu._setMenuVisible(true);
    // XrManipulation treats any visible XrMenu as a modal dialog. This palette
    // is persistent, so only ray hits on its buttons should capture input.
    this.handle.app.fire("xr:menu:active", false);
    this.refresh();
  }

  private navigate() {
    if (!this.menu._menuVisible) return;
    if (this.tool === "measure" && this.measurement().discardUnsaved()) this.changed();
    this.tool = "navigate";
    this.armed = false; this.skipNextRelease = false;
    this.refresh();
  }
  private measureTool() {
    if (!this.menu._menuVisible) return;
    this.tool = "measure"; this.armed = true; this.skipNextRelease = true;
    this.message = "Aim at a surface; tap right trigger";
    this.refresh();
  }
  private arm() {
    if (this.tool !== "measure" || !this.menu._menuVisible) return;
    this.moving = null; this.armed = true;
    this.previewOrigin.set(Infinity, Infinity, Infinity);
    this.skipNextRelease = true; // The UI trigger cannot also place point A.
    this.message = "Aim at a surface; tap right trigger"; this.refresh();
  }
  private current() {
    const records = this.measurement().records;
    return records.find(record => record.id === this.selectedId) ?? records.at(-1);
  }
  private save() {
    if (this.tool !== "measure" || !this.menu._menuVisible) return;
    const record = this.current();
    if (record?.points.length !== 2) { this.message = "Place two surface points first"; this.refresh(); return; }
    this.measurement().save(record.id, record.name);
    this.selectedId = record.id; this.armed = false; this.moving = null;
    this.message = `${record.name} saved`; this.changed(); this.refresh();
  }
  private cancel() {
    if (this.tool !== "measure" || !this.menu._menuVisible) return;
    this.measurement().discardUnsaved();
    this.armed = false; this.moving = null; this.selectedId = null;
    this.message = "Draft discarded"; this.changed(); this.refresh();
  }
  private previous() {
    if (this.tool !== "measure" || !this.menu._menuVisible) return;
    const saved = this.measurement().records.filter(record => record.saved);
    if (!saved.length) { this.message = "No saved measurements"; this.refresh(); return; }
    const at = saved.findIndex(record => record.id === this.selectedId);
    this.selectedId = saved[(at + 1) % saved.length]!.id;
    this.message = saved[(at + 1) % saved.length]!.name;
    this.refresh();
  }
  private moveA() { this.move(0); }
  private moveB() { this.move(1); }
  private move(index: 0 | 1) {
    if (this.tool !== "measure" || !this.menu._menuVisible || this.current()?.points.length !== 2) return;
    this.moving = index; this.armed = true;
    this.previewOrigin.set(Infinity, Infinity, Infinity);
    this.skipNextRelease = true;
    this.message = `Aim and tap to move point ${index ? "B" : "A"}`; this.refresh();
  }

  // A trigger tap places a point. Sustained controller motion is owned by pan,
  // so a pan release cannot also create a measurement.
  private selectStart(source: XrInputSource) {
    this.tapping = this.isArmed && source.handedness === "right" && !this.isMenuTargeted;
    this.dragged = false;
    if (this.tapping) this.tapOrigin.copy(source.getPosition() ?? source.getOrigin());
  }
  private trackTap() {
    if (!this.tapping || this.dragged) return;
    const right = this.handle.app.xr?.input.inputSources.find(source => source.handedness === "right");
    if (right && this.tapOrigin.distance(right.getPosition() ?? right.getOrigin()) >= .02) this.dragged = true;
  }
  private previewPoint() {
    const source = this.handle.app.xr?.input.inputSources.find(input => input.handedness === "right" && !input.hand);
    if (!this.isArmed || !this.ready() || !source || this.isMenuTargeted || source.selecting || this.dragged) {
      this.pointPreview.enabled = false; return;
    }
    const origin = source.getOrigin(), direction = source.getDirection();
    const transform = this.handle.space.root.getWorldTransform();
    if (this.previewBusy || performance.now() - this.previewAt < 120 ||
      (origin.distance(this.previewOrigin) < .005 && direction.distance(this.previewDirection) < .01 &&
        transform.equals(this.previewTransform))) return;
    this.previewAt = performance.now(); this.previewBusy = true;
    this.previewOrigin.copy(origin); this.previewDirection.copy(direction); this.previewTransform.copy(transform);
    void this.pick(source).then(point => {
      if (this.disposed || !this.isArmed || !point || source.selecting || this.isMenuTargeted) {
        this.pointPreview.enabled = false; return;
      }
      // Raise the dot slightly toward the pointer to avoid burying it in the surface.
      const toward = source.getOrigin().clone().sub(point).normalize().mulScalar(.006);
      this.pointPreview.setPosition(point.clone().add(toward));
      this.pointPreview.enabled = true;
    }).catch(() => { this.pointPreview.enabled = false; }).finally(() => { this.previewBusy = false; });
  }
  private async selectEnd(source: XrInputSource) {
    if (source.handedness === "right" && this.skipNextRelease) {
      this.skipNextRelease = false; this.tapping = false; return;
    }
    const tapped = this.tapping && !this.dragged && this.tapOrigin.distance(source.getPosition() ?? source.getOrigin()) < .02;
    this.tapping = false;
    if (!tapped || !this.isArmed || !this.ready() || this.busy || source.handedness !== "right" || this.isMenuTargeted) return;
    if (!source.getOrigin() || !source.getDirection()) return;
    this.busy = true;
    this.pointPreview.enabled = false;
    try {
      const point = await this.pick(source);
      if (this.disposed || !this.isArmed) return;
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
        this.moving = null; this.armed = false; this.open();
      } else {
        const last = model.records.at(-1);
        if (last && !last.saved && last.points.length === 1 && last.points[0]!.distance(local) < 1e-6) {
          this.message = "Aim at a different point B"; return;
        }
        model.add(local, !last || last.saved || last.points.length === 2);
        this.selectedId = model.records.at(-1)?.id ?? null;
        if (model.points.length === 2) { this.armed = false; this.open(); }
        else this.message = "Point A placed; aim at point B";
      }
      this.changed();
    } catch (error) {
      if (!this.disposed) this.message = error instanceof Error ? error.message : String(error);
    } finally {
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
    const record = this.current();
    this.menu.setItemLabel(0, this.tool === "measure" ? "Navigate" : "● Navigate");
    this.menu.setItemLabel(1, this.tool === "measure" ? "● Measure distance" : "Measure distance");
    this.menu.setItemLabel(3, this.tool === "measure" ? this.message : "Choose a tool");
    this.menu.setItemLabel(7, record?.saved ? `Saved: ${record.name}` : "Choose saved measurement");
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    const app: AppBase = this.handle.app;
    app.xr?.input.off("selectstart", this.selectStart, this);
    app.xr?.input.off("selectend", this.selectEnd, this);
    app.off("update", this.trackTap, this);
    app.off("update", this.previewPoint, this);
    app.off(events.navigate, this.navigate, this); app.off(events.measure, this.measureTool, this);
    app.off(events.pick, this.arm, this); app.off(events.save, this.save, this);
    app.off(events.cancel, this.cancel, this); app.off(events.previous, this.previous, this);
    app.off(events.moveA, this.moveA, this); app.off(events.moveB, this.moveB, this);
    this.menuHost.script?.destroy("xrMenu"); this.pickEntity?.destroy(); this.picker?.destroy();
    this.pointPreview.destroy(); this.previewMaterial.destroy();
    app.scene.layers.remove(this.previewLayer);
    app.assets.remove(this.fontAsset); this.font.destroy();
  }
}
