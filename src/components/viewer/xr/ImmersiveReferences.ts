import { BoundingSphere, Color, Entity, Gizmo, Quat, Ray, StandardMaterial, TransformGizmo, Vec3, WireRenderer, type XrInputSource } from "playcanvas";
import type { SegmentWorkspaces } from "../segments/SegmentWorkspaces";
import type { SelectionHandle, SelectionTool } from "../selection/types";
import { toolAppearance } from "../toolAppearance";
import { SectionPlaneVisual } from "../section/SectionPlaneVisual";
import { defaultSectionOptions } from "../section/SectionDocument";
import { sectionFrame, sectionTilts } from "../section/sectionPlane";
import { directionFrame, threePointFrame, type NamedView } from "../views/viewFrame";
import { ControllerRotateGizmo } from "./ControllerRotateGizmo";
import type { ImmersiveInput } from "./ImmersiveInput";
import type { ImmersiveScene } from "./ImmersiveScene";

// XR input/scene presentation over the shared views, sections and source-space
// plane operations. Only the small editor handles are queried while hovering.
export class ImmersiveReferences {
  mode: "views" | "section" | null = null;
  drafting = false;
  editing: number | null = null;
  name = "";
  picking = false;
  message = "";
  private points: Vec3[] = [];
  private before: NamedView | null = null;
  private viewHistory: NamedView[] = [];
  private cursor = -1;
  private gestureBefore: NamedView | null = null;
  private gizmo: ControllerRotateGizmo | null = null;
  private reference: Entity | null = null;
  private releaseLayer: (() => void) | null = null;
  private guide: SectionPlaneVisual | null = null;
  private offsetHandle: Entity | null = null;
  private offsetMaterial: StandardMaterial | null = null;
  private offsetDrag: { origin: Vec3; axis: Vec3; value: number; span: number } | null = null;
  private readonly sphere = new BoundingSphere(new Vec3(), .04);
  private readonly ray = new Ray();
  private readonly hitPoint = new Vec3();
  private pointer: Vec3 | null = null;
  private disposed = false;
  private revision = 0;
  private readonly grid: Vec3[] = [];
  private readonly worldGrid: Vec3[] = [];
  private readonly gridColor = new Color(.35, .35, .35);
  private pointWire: WireRenderer | null = null;
  private readonly gold: Color;
  readonly section;
  get views() { return this.workspaces.current.views; }
  get dragging() { return !!this.offsetDrag || !!this.gizmo?.dragging; }
  constructor(private readonly handle: SelectionHandle, private readonly workspaces: SegmentWorkspaces,
    private readonly scene: ImmersiveScene, private readonly input: ImmersiveInput,
    private readonly changed: () => void, private readonly menuTargeted: () => boolean, private readonly ready: () => boolean) {
    this.section = workspaces.current.section;
    // Read inherited desktop styles before entering XR, like the spatial UI.
    // XR runtimes may no longer expose those inherited canvas values afterward.
    this.gold = new Color().fromString(toolAppearance(handle.app.graphicsDevice.canvas as HTMLCanvasElement).gold).linear();
    const camera = handle.viewports.perspectivePanel.camera.entity;
    this.section.adapter = { capture: () => scene.captureView(camera), restore: view => scene.restoreView(view, camera),
      look: frame => scene.look(frame, camera) };
    this.section.on("change", this.sync, this); this.views.on("change", this.sync, this);
    handle.app.on("update", this.update, this);
    handle.app.on("prerender", this.drawGrid, this);
  }
  setTool(tool: SelectionTool) {
    this.revision++;
    this.end();
    if (this.mode === "views") this.cancelView();
    if (this.mode === "section") this.section.leave();
    this.clearVisuals(); this.mode = tool === "views" || tool === "section" ? tool : null;
    if (this.mode === "section") this.section.enter();
    this.sync();
  }
  private snapshot() { return this.section.adapter.capture(); }
  createView() {
    this.cancelView(); this.before = this.snapshot(); this.editing = null; this.name = "";
    this.drafting = true; this.picking = false; this.viewHistory = [this.snapshot()]; this.cursor = 0; this.sync();
  }
  openView(id: number) {
    const view = this.views.records.find(view => view.id === id); if (!view) return;
    this.cancelView(); this.before = this.snapshot(); this.section.adapter.restore(view);
    this.editing = id; this.name = view.name; this.drafting = true; this.picking = false;
    this.viewHistory = [this.snapshot()]; this.cursor = 0; this.sync();
  }
  saveView() {
    if (!this.drafting || !this.name.trim()) return;
    this.views.save({ ...this.snapshot(), id: this.editing ?? undefined, name: this.name.trim() });
    this.before = null; this.drafting = this.picking = false; this.sync();
  }
  cancelView() {
    if (this.before) this.section.adapter.restore(this.before);
    this.before = null; this.drafting = this.picking = false; this.points = []; this.sync();
  }
  removeView(id: number) { if (this.editing === id) this.cancelView(); this.views.remove(id); }
  action(action: string, value?: string | number) {
    this.message = "";
    if (this.mode === "views") {
      if (action === "create") this.createView();
      else if (action === "open") this.openView(Number(value));
      else if (action === "remove") this.removeView(Number(value));
      else if (action === "name") this.name = String(value);
      else if (action === "save") this.saveView();
      else if (action === "cancel") this.cancelView();
      else if (action === "points") { this.revision++; this.points = []; this.picking = true; this.pointWire ??= new WireRenderer(this.handle.app); }
      else if (action === "cancel-points") { this.revision++; this.points = []; this.picking = false; }
      else if (action === "reset") { this.gestureBefore = this.snapshot(); this.handle.space.setRotation(Quat.IDENTITY); this.commitView(); }
      else if (action === "direction") {
        const normal = { Front: Vec3.BACK, Back: Vec3.FORWARD, Left: Vec3.LEFT, Right: Vec3.RIGHT, Top: Vec3.UP, Bottom: Vec3.DOWN }[String(value)];
        if (normal) { this.gestureBefore = this.snapshot(); this.section.adapter.look(directionFrame(this.snapshot().frame,normal)); this.commitView(); }
      }
    } else if (this.mode === "section") {
      if (action === "open") this.section.sections.open(Number(value));
      else if (action === "remove") this.section.sections.remove(Number(value));
      else if (action === "name") this.section.name(String(value));
      else if (action === "save") this.section.save();
      else if (action === "new") this.section.fresh();
      else if (action === "enable") this.section.state.enabled ? this.section.sections.close() : this.section.enable(true);
      else if (action === "flip") this.section.options({ flip: !this.section.state.options.flip });
      else if (action === "plane") this.section.showPlane(!this.section.state.showPlane);
      else if (action === "camera") this.section.fromCamera();
      else if (action === "view") this.section.chooseView(String(value));
      else if (action === "align") this.section.align(value as "view" | "X" | "Y" | "Z");
      else if (action === "look") this.section.look();
      else if (action === "reset") this.section.options(defaultSectionOptions);
    }
    this.sync();
  }
  async pick(source: XrInputSource) {
    if (this.mode !== "views" || !this.picking) return;
    const revision = this.revision;
    const hit = await this.input.pick(source);
    if (!hit || this.disposed || !this.picking || revision !== this.revision) return;
    this.points.push(this.handle.space.root.getLocalTransform().transformPoint(hit.point));
    if (this.points.length === 3) {
      try {
        const frame = threePointFrame(this.snapshot().frame, this.points as [Vec3, Vec3, Vec3]);
        this.gestureBefore = this.snapshot();
        this.handle.space.setRotation(frame.rotation.clone().invert().mul(this.handle.space.rotation)); this.commitView();
        this.picking = false;
      } catch (error) { this.message = String(error); }
      this.points = [];
    }
    this.sync();
  }
  get pointMessage() { return this.picking ? `Pick point ${this.points.length + 1} of 3` : ""; }
  undo() {
    if (this.mode === "section") this.section.undo();
    else if (this.cursor > 0) this.section.adapter.restore(this.viewHistory[--this.cursor]!);
    this.sync();
  }
  redo() {
    if (this.mode === "section") this.section.redo();
    else if (this.cursor + 1 < this.viewHistory.length) this.section.adapter.restore(this.viewHistory[++this.cursor]!);
    this.sync();
  }
  private commitView() {
    if (!this.gestureBefore) return;
    this.viewHistory.splice(this.cursor + 1); this.viewHistory[this.cursor] = this.gestureBefore;
    this.viewHistory.push(this.snapshot()); this.cursor++; this.gestureBefore = null;
  }
  private sphereTarget(source: XrInputSource) {
    if (!this.offsetHandle?.enabled) return null;
    this.sphere.center.copy(this.offsetHandle.getPosition()); this.ray.set(source.getOrigin(), source.getDirection());
    return this.sphere.intersectsRay(this.ray, this.hitPoint) ? this.hitPoint : null;
  }
  target(source: XrInputSource) { return source.handedness === "right" && this.ready() ? this.pointer : null; }
  start(source: XrInputSource) {
    if (!this.ready() || !this.mode) return false;
    if (this.sphereTarget(source)) {
      const reference = this.section.reference, bounds = this.section.bounds;
      if (!reference || !bounds) return false;
      const options = this.section.state.options, zero = sectionFrame(reference, bounds, { ...options, offset: 0 });
      const one = sectionFrame(reference, bounds, { ...options, offset: 1 });
      const axis = this.scene.root.getWorldTransform().transformVector(one.origin.sub(zero.origin));
      const span = axis.length(); if (span < 1e-8) return false;
      this.offsetDrag = { origin: (source.getPosition() ?? source.getOrigin()).clone(), axis: axis.mulScalar(1 / span), value: options.offset, span };
      this.section.begin(); return true;
    }
    return this.gizmo?.start(source) ?? false;
  }
  end() {
    if (this.offsetDrag) { this.offsetDrag = null; this.section.commit(); }
    this.gizmo?.end(); this.sync();
  }
  private update() {
    if (!this.mode || !this.ready()) return;
    if (!this.gizmo && (this.mode === "views" ? this.drafting && !this.picking : this.section.state.enabled)) this.sync();
    const source = this.handle.app.xr?.input.inputSources.find(source => source.handedness === "right");
    if (!source) return;
    if (this.offsetDrag) {
      const drag = this.offsetDrag;
      const displacement = source.getPosition()!.clone().sub(drag.origin).dot(drag.axis);
      this.section.options({ offset: Math.max(-1, Math.min(1, drag.value + displacement / drag.span)) });
    }
    this.pointer = this.menuTargeted() ? null : this.sphereTarget(source)?.clone() ?? this.gizmo?.move(source)?.clone() ?? null;
    if (this.offsetHandle) {
      const size = .045 / this.scene.root.getLocalScale().x; this.offsetHandle.setLocalScale(size, size, size);
    }
  }
  private sync() {
    if (this.disposed) return;
    const editable = this.ready() && (this.mode === "views" ? this.drafting && !this.picking : this.mode === "section" && this.section.state.enabled);
    if (editable && !this.gizmo) this.createGizmo();
    if (!editable && this.gizmo) this.clearVisuals();
    const frame = this.mode === "section" ? this.section.frame : null;
    if (this.reference && !this.dragging) {
      this.reference.setLocalPosition(frame?.origin ?? this.handle.space.pivot);
      this.reference.setLocalRotation(frame?.rotation ?? this.handle.space.rotation);
    }
    if (frame && this.guide) {
      this.guide.root.enabled = this.section.state.showPlane;
      this.guide.update(frame, this.section.bounds!.halfExtents.length());
      this.offsetHandle?.setLocalPosition(frame.origin);
    }
    if (!this.dragging) this.changed();
  }
  private createGizmo() {
    const layers = this.handle.app.scene.layers;
    const layer = Gizmo.createLayer(this.handle.app, "XR reference handles", layers.layerList.findIndex(layer => layer.name === "UI"));
    const node = this.reference = new Entity("XR reference rotation"); this.scene.root.addChild(node);
    const frame = this.mode === "section" ? this.section.frame : null;
    node.setLocalPosition(frame?.origin ?? this.handle.space.pivot);
    node.setLocalRotation(frame?.rotation ?? this.handle.space.rotation);
    this.gizmo = new ControllerRotateGizmo(this.handle.viewports.perspectivePanel.camera, layer);
    this.releaseLayer = () => {
      const camera = this.handle.viewports.perspectivePanel.camera;
      camera.layers = camera.layers.filter(id => id !== layer.id);
    };
    this.gizmo.coordSpace = "local"; this.gizmo.size = 2;
    if (this.mode === "section") {
      this.gizmo.planeOnly();
      this.guide = new SectionPlaneVisual(this.handle, this.scene.root);
      const sphere = this.offsetHandle = new Entity("XR section offset handle"); this.scene.root.addChild(sphere);
      const material = this.offsetMaterial = new StandardMaterial();
      material.useLighting = material.useFog = material.useTonemap = material.useSkybox = false;
      material.emissive.copy(this.gold); material.diffuse.copy(this.gold);
      material.depthTest = material.depthWrite = false; material.update();
      sphere.addComponent("render", { type: "sphere", material, layers: [layer.id], castShadows: false, receiveShadows: false });
      const size = .045 / this.scene.root.getLocalScale().x; sphere.setLocalScale(size,size,size);
    }
    this.gizmo.attach([node]);
    if (this.mode === "views") {
      const bounds = this.section.bounds ?? this.scene.bounds, extent = bounds.halfExtents.length(), p = this.handle.space.pivot;
      this.grid.length = this.worldGrid.length = 0;
      for (let i = -10; i <= 10; i++) {
        const offset = extent * i / 10;
        this.grid.push(new Vec3(p.x-extent,p.y,p.z+offset),new Vec3(p.x+extent,p.y,p.z+offset),
          new Vec3(p.x+offset,p.y,p.z-extent),new Vec3(p.x+offset,p.y,p.z+extent));
      }
      this.grid.forEach(() => this.worldGrid.push(new Vec3()));
    }
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMSTART, () => {
      if (this.mode === "section") this.section.begin(); else this.gestureBefore = this.snapshot();
    });
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMMOVE, () => {
      if (this.mode === "section" && this.section.reference) this.section.options(sectionTilts(this.section.reference.rotation, node.getLocalRotation()));
      else if (!this.handle.space.rotation.equalsApprox(node.getLocalRotation())) this.handle.space.setRotation(node.getLocalRotation());
    });
    this.gizmo.on(TransformGizmo.EVENT_TRANSFORMEND, () => {
      if (this.mode === "section") this.section.commit(); else this.commitView();
    });
  }
  private clearVisuals() {
    const layer = this.gizmo?.layer;
    this.gizmo?.destroy(); this.gizmo = null; this.reference?.destroy(); this.reference = null;
    this.guide?.destroy(); this.guide = null; this.offsetHandle?.destroy(); this.offsetHandle = null;
    this.offsetMaterial?.destroy(); this.offsetMaterial = null;
    this.releaseLayer?.(); this.releaseLayer = null;
    if (layer) this.handle.app.scene.layers.remove(layer);
    this.pointer = null;
    this.grid.length = this.worldGrid.length = 0;
  }
  private drawGrid() {
    if (this.mode !== "views" || !this.drafting || !this.ready()) return;
    const transform = this.scene.root.getWorldTransform();
    if (this.grid.length) {
      this.grid.forEach((point,index) => transform.transformPoint(point,this.worldGrid[index]!));
      this.handle.app.drawLines(this.worldGrid,this.gridColor,true);
    }
    this.points.forEach(point => this.pointWire?.sphere(transform.transformPoint(point),.008));
  }
  destroy() {
    this.setTool("navigate"); this.disposed = true;
    this.section.adapter = this.section.desktopAdapter();
    this.section.off("change", this.sync, this); this.views.off("change", this.sync, this);
    this.handle.app.off("update", this.update, this); this.clearVisuals();
    this.handle.app.off("prerender", this.drawGrid, this);
    this.pointWire = null;
  }
}
