import { Asset, CanvasFont, Entity, Picker, Vec2, Vec3, type AppBase, type CameraComponent, type XrInputSource } from "playcanvas";
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
  private picker: Picker | null = null;
  private pickCamera: CameraComponent | null = null;
  private readonly aim = new Vec3();
  private readonly tapOrigin = new Vec3();
  private tapping = false;
  private dragged = false;
  private skipNextRelease = false;
  private togglePressed = false;
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
    this.menuHost = handle.viewports.perspectivePanel.camera.entity;
    this.font = new CanvasFont(app, { fontName: "Arial", fontSize: 32 });
    this.font.createTextures("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:-…/()");
    this.fontAsset = new Asset("XR tool font", "font");
    this.fontAsset.resource = this.font;
    app.assets.add(this.fontAsset);
    this.menuHost.script ?? this.menuHost.addComponent("script");
    this.menu = this.menuHost.script!.create(XrMenu, { properties: {
      fontAsset: this.fontAsset, preferredHand: "left", toggleButtonIndex: 9,
      buttonWidth: .26, buttonHeight: .032, fontSize: 16,
      menuOffset: new Vec3(.15, 0, .08), followDistance: .7, followOffset: new Vec2(.28, -.12),
      menuItems: [
        { label: "Navigate", eventName: events.navigate },
        { label: "Measure distance", eventName: events.measure },
        { label: this.message },
        { label: "Place points", eventName: events.pick },
        { label: "Save measurement", eventName: events.save },
        { label: "Cancel draft", eventName: events.cancel },
        { label: "Saved measurement", eventName: events.previous },
        { label: "Move point A", eventName: events.moveA },
        { label: "Move point B", eventName: events.moveB }
      ]
    } }) as unknown as XrMenu;
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
    app.on("update", this.menuToggle, this);
    app.on("update", this.trackTap, this);
    this.refresh();
  }

  get isArmed() { return this.tool === "measure" && this.armed; }
  get isMenuTargeted() { return this.menu.isPointerOverMenu; }
  get currentTool() { return this.tool; }

  setTool(tool: SelectionTool) {
    if (this.tool === tool) return;
    this.tool = tool; this.armed = false; this.moving = null; this.skipNextRelease = false;
    if (tool === "measure") this.open();
    else this.hide();
    this.refresh();
  }

  open() {
    this.armed = false;
    // Pinned XrMenu 2.21 runs controller-ray hit testing in always-visible
    // mode; its controller-anchored branch only toggles and follows.
    this.menu.alwaysVisible = true;
    this.menu._setMenuVisible(true);
    this.refresh();
  }

  private hide() {
    this.menu.alwaysVisible = false;
    this.menu._setMenuVisible(false);
    // XrMenu fades out its UI but leaves the container interactive during the
    // fade. A release can otherwise activate a second row after a tool switch.
    if (this.menu._menuContainer) this.menu._menuContainer.enabled = false;
  }

  private navigate() {
    if (!this.menu._menuVisible) return;
    this.hide();
    if (this.tool === "measure" && this.measurement().discardUnsaved()) this.changed();
    this.tool = "navigate";
    this.armed = false; this.skipNextRelease = false;
  }
  private measureTool() { if (this.menu._menuVisible) { this.tool = "measure"; this.open(); } }
  private menuToggle() {
    const left = this.handle.app.xr?.input.inputSources.find(source => source.handedness === "left" && !source.hand);
    const pressed = !!left?.gamepad?.buttons[5]?.pressed;
    if (pressed && !this.togglePressed) {
      if (this.menu.alwaysVisible) this.hide();
      else this.open();
    }
    this.togglePressed = pressed;
  }
  private arm() {
    if (this.tool !== "measure" || !this.menu._menuVisible) return;
    this.moving = null; this.armed = true;
    this.skipNextRelease = true; // The UI trigger cannot also place point A.
    this.hide();
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
    this.skipNextRelease = true;
    this.hide();
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
  private async selectEnd(source: XrInputSource) {
    if (source.handedness === "right" && this.skipNextRelease) {
      this.skipNextRelease = false; this.tapping = false; return;
    }
    const tapped = this.tapping && !this.dragged && this.tapOrigin.distance(source.getPosition() ?? source.getOrigin()) < .02;
    this.tapping = false;
    if (!tapped || !this.isArmed || !this.ready() || this.busy || source.handedness !== "right" || this.isMenuTargeted) return;
    if (!source.getOrigin() || !source.getDirection()) return;
    this.busy = true;
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
    this.menu.setItemLabel(2, this.tool === "measure" ? this.message : "Choose a tool");
    this.menu.setItemLabel(6, record?.saved ? `Saved: ${record.name}` : "Choose saved measurement");
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    const app: AppBase = this.handle.app;
    app.xr?.input.off("selectstart", this.selectStart, this);
    app.xr?.input.off("selectend", this.selectEnd, this);
    app.off("update", this.menuToggle, this);
    app.off("update", this.trackTap, this);
    app.off(events.navigate, this.navigate, this); app.off(events.measure, this.measureTool, this);
    app.off(events.pick, this.arm, this); app.off(events.save, this.save, this);
    app.off(events.cancel, this.cancel, this); app.off(events.previous, this.previous, this);
    app.off(events.moveA, this.moveA, this); app.off(events.moveB, this.moveB, this);
    this.menuHost.script?.destroy("xrMenu"); this.pickEntity?.destroy(); this.picker?.destroy();
    app.assets.remove(this.fontAsset); this.font.destroy();
  }
}
