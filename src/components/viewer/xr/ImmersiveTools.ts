import { Vec3, type XrInputSource } from "playcanvas";
import { SurfacePointMarker } from "../picking/SurfacePointMarker";
import { ImmersiveInput } from "./ImmersiveInput";
import { ImmersiveEditing } from "./ImmersiveEditing";
import type { SegmentWorkspaces } from "../segments/SegmentWorkspaces";
import type { Measurement } from "../measurement/Measurement";
import type { SelectionHandle, SelectionTool } from "../selection/types";
import { ToolPanel } from "./ToolPanel";
import { spatialInput } from "./SpatialPanel";

// Session tool input/presentation over the shared desktop documents.
export class ImmersiveTools {
  private readonly ui: ToolPanel;
  private readonly releaseInput: () => void;
  private readonly pointPreview: SurfacePointMarker;
  private readonly editing: ImmersiveEditing;
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
    private readonly changed: () => void, private readonly ready: () => boolean, private readonly input: ImmersiveInput,
    private readonly workspaces: SegmentWorkspaces) {
    const app = handle.app, camera = handle.viewports.perspectivePanel.camera;
    this.releaseInput = spatialInput(app);
    this.editing = new ImmersiveEditing(handle, workspaces, input, () => this.commit());
    input.setExtraTarget(source => this.tool === "select" ? this.editing.depthHandleTarget(source) : null);
    this.ui = new ToolPanel(app, camera.entity, {
      tool: tool => this.setTool(tool),
      open: id => { this.revision++; this.selectedId = id; this.name = this.current()!.name; this.armed = false; this.refresh(); },
      remove: id => { this.revision++; this.measurement().remove(id); if (id === this.selectedId) this.selectedId = null; this.commit(); },
      name: value => { this.name = value; this.refresh(); }, save: () => this.save(),
      clear: () => { this.revision++; this.measurement().clear(); this.selectedId = null; this.armed = true; this.commit(); },
      style: style => { this.measurement().setStyle(style); this.commit(); }
    });
    this.pointPreview = new SurfacePointMarker(handle);
    app.xr!.input.on("selectstart", this.selectStart, this); app.xr!.input.on("selectend", this.selectEnd, this);
    app.xr!.input.on("remove", this.cancelPointer, this);
    app.on("update", this.trackTap, this); app.on("update", this.previewPoint, this);
    this.refresh();
  }
  get isArmed() { return this.tool === "measure" && this.armed; }
  get isMenuTargeted() { return this.ui.targeted; }
  get blocksPan() { return this.ui.targeted || this.moving !== null || this.editing.drawing ||
    this.editing.starting !== null || this.editing.depthDragging || this.editing.dragging; }
  get currentTool() { return this.tool; }
  undo() {
    if (this.tool === "select") { this.editing.clearVolume(); this.workspaces.history.undo(); this.editing.selectionId = null; this.input.invalidate(); }
    else if (this.tool === "annotate") { this.workspaces.current.annotations.undo(); this.editing.annotate("cancel"); }
    else if (this.tool === "measure") { this.measurement().undo(); if (!this.current()) this.selectedId = null; }
    this.commit();
  }
  redo() {
    if (this.tool === "select") { this.editing.clearVolume(); this.workspaces.history.redo(); this.editing.selectionId = null; this.input.invalidate(); }
    else if (this.tool === "annotate") { this.workspaces.current.annotations.redo(); this.editing.annotate("cancel"); }
    else if (this.tool === "measure") { this.measurement().redo(); if (!this.current()) this.selectedId = null; }
    this.commit();
  }
  frameChord() {
    this.editing.cancelGesture(); this.tapping = this.dragged = false; this.moving = null;
    this.pointPreview.set(null);
  }
  setTool(tool: SelectionTool) {
    this.revision++;
    if (tool !== "measure" && this.tool === "measure" && this.measurement().discardUnsaved()) this.changed();
    this.tool = ["measure", "select", "annotate"].includes(tool) ? tool : "navigate";
    this.editing.setTool(this.tool);
    this.armed = this.tool === "measure"; this.moving = null; this.selectedId = null; this.message = "";
    this.pointPreview.set(null); this.commit();
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
    if (this.tool === "select" && !this.isMenuTargeted && this.ready() &&
      (this.input.hit(source) || this.editing.depthHandleNear(source))) { this.editing.start(source); return; }
    if (!this.isMenuTargeted && this.editing.beginAnnotationDrag(source)) return;
    this.tapping = (this.tool === "measure" || this.tool === "annotate") && !this.isMenuTargeted;
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
    const source = this.handle.app.xr?.input.inputSources.find(input => input.handedness === "right");
    if (source && (this.editing.drawing || this.editing.depthDragging)) this.editing.track(source);
    if (!this.tapping || this.dragged) return;
    const right = this.handle.app.xr?.input.inputSources.find(source => source.handedness === "right");
    if (right && this.tapOrigin.distance(right.getPosition() ?? right.getOrigin()) >= .02) this.dragged = true;
  }
  private cancelPointer(source: XrInputSource) {
    if (source.handedness !== "right") return;
    this.editing.cancelGesture();
    this.revision++; this.moving = null; this.tapping = this.dragged = false;
    this.armed = this.tool === "measure" && this.current()?.points.length !== 2;
  }
  private previewPoint() {
    const source = this.handle.app.xr?.input.inputSources.find(input => input.handedness === "right" && !input.hand);
    if (source) this.editing.hover(this.isMenuTargeted ? null : this.input.hit(source), this.isMenuTargeted ? undefined : source);
    if (this.tool === "select" && this.editing.startPoint) { this.pointPreview.set(this.editing.startPoint); return; }
    if (this.tool === "annotate" && this.editing.draft?.position && this.editing.step === "details") {
      this.pointPreview.set(this.editing.draft.position); return;
    }
    const previewing = this.isArmed || this.tool === "select" || (this.tool === "annotate" && (this.editing.step === "marker" || this.editing.step === "drag"));
    if (!previewing || !this.ready() || !source || this.isMenuTargeted ||
      (this.moving === null && (source.selecting || this.dragged))) {
      this.pointPreview.set(null); return;
    }
    const hit = this.input.hit(source);
    this.pointPreview.set(hit?.point ?? null);
  }
  private async selectEnd(source: XrInputSource) {
    if (source.handedness !== "right") return;
    if (this.editing.drawing || this.editing.starting || this.editing.depthDragging) { await this.editing.end(); return; }
    const tapped = this.tapping && !this.dragged && this.tapOrigin.distance(source.getPosition() ?? source.getOrigin()) < .02;
    this.tapping = false; this.dragged = false;
    if (this.tool === "annotate") {
      if ((tapped || this.editing.dragging) && !this.isMenuTargeted && this.ready()) await this.editing.click(source);
      return;
    }
    if ((!tapped && this.moving === null) || !this.isArmed || !this.ready() || this.busy || this.isMenuTargeted) {
      if (this.moving !== null) { this.moving = null; this.armed = false; }
      return;
    }
    if (!source.getOrigin() || !source.getDirection()) return;
    this.busy = true;
    const revision = this.revision;
    this.pointPreview.set(null);
    try {
      if (this.disposed || revision !== this.revision) return;
      const point = await this.pick(source);
      if (this.disposed || revision !== this.revision || !this.isArmed) return;
      if (!point) { this.message = "Aim at a visible surface"; return; }
      const model = this.measurement();
      const local = point;
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

  private pick(source: XrInputSource) {
    return this.input.pick(source).then(hit => hit?.point ?? null);
  }

  private refresh() {
    const model = this.measurement();
    this.ui.render({ active: this.tool !== "navigate", tool: this.tool, editing: this.editing, records: model.records, selectedId: this.selectedId,
      name: this.name, message: this.message, style: model.style, busy: this.busy });
  }
  destroy() {
    this.input.setExtraTarget(null);
    if (this.disposed) return;
    this.disposed = true;
    const app = this.handle.app;
    app.xr?.input.off("selectstart", this.selectStart, this); app.xr?.input.off("selectend", this.selectEnd, this);
    app.xr?.input.off("remove", this.cancelPointer, this);
    app.off("update", this.trackTap, this); app.off("update", this.previewPoint, this);
    this.editing.destroy(); this.ui.destroy(); this.releaseInput(); this.pointPreview.destroy();
  }
}
