import { BoundingBox, EventHandler } from "playcanvas";
import type { SavedPresets } from "../presets/SavedPresets";
import type { SelectionHandle } from "../selection/types";
import { axisFrame, captureFrame, copyFrame, restoreView, type NamedView, type ViewAxis, type ViewFrame } from "../views/viewFrame";
import { cutawayView, planeCoefficients, sectionFrame, setSectionPlane, type SectionOptions } from "./sectionPlane";

export interface NamedSection {
  id: number; name: string; view: NamedView; reference: ViewFrame; source: string;
  alignment: ViewAxis | "view"; options: SectionOptions;
}
export interface SectionSession {
  editing?: number | null; name?: string; reference?: ViewFrame | null; source?: string;
  alignment?: ViewAxis | "view"; enabled?: boolean; showPlane?: boolean; options?: SectionOptions;
}

export const defaultSectionOptions: SectionOptions = { offset: 0, tiltX: 0, tiltY: 0, flip: false };
export interface SectionViewAdapter {
  capture(): NamedView;
  restore(view: NamedView): void;
  look(frame: ViewFrame): void;
}

// One source-space cut/document for desktop and XR. Presentation adapters may
// move the artifact instead of the tracked camera; saved records stay identical.
export class SectionDocument extends EventHandler {
  readonly state: Required<SectionSession> = { editing: null, name: "", reference: null, source: "camera",
    alignment: "view", enabled: false, showPlane: true, options: { ...defaultSectionOptions } };
  adapter: SectionViewAdapter;
  private baseBounds: BoundingBox | null = null;
  private history: Required<SectionSession>[] = [];
  private cursor = -1;
  private pending: Required<SectionSession> | null = null;
  private lastPlane: Float32Array | null | undefined;
  private attached = false;
  constructor(readonly handle: SelectionHandle, readonly sections: SavedPresets<NamedSection>, readonly views: SavedPresets<NamedView>) {
    super();
    this.adapter = this.desktopAdapter();
  }
  desktopAdapter(): SectionViewAdapter {
    return { capture: () => ({ id: 0, name: "", frame: captureFrame(this.handle.camera()), assetRotation: this.handle.space.rotation }),
      restore: view => restoreView(this.handle, view), look: frame => this.handle.viewports.restorePerspective(frame) };
  }
  get bounds() {
    if (!this.baseBounds) return null;
    const bounds = new BoundingBox(); bounds.setFromTransformedAabb(this.baseBounds, this.handle.space.root.getLocalTransform()); return bounds;
  }
  get reference() {
    return this.state.reference && (this.state.alignment === "view" ? this.state.reference : axisFrame(this.state.reference, this.state.alignment));
  }
  get frame() { const bounds = this.bounds, reference = this.reference; return bounds && reference ? sectionFrame(reference, bounds, this.state.options) : null; }
  attach() {
    this.attached = true;
    this.lastPlane = undefined;
    this.baseBounds = this.handle.selection.bounds(null, this.handle.space.root);
    this.sections.on("open", this.open, this); this.sections.on("close", this.close, this);
    this.sections.on("visibility", this.visibility, this); this.sections.on("change", this.rename, this);
    this.handle.space.on("change", this.render, this);
    const detach = () => {
      if (!this.attached) return;
      this.attached = false; this.handle.app.off("destroy", detach);
      this.sections.off("open", this.open, this); this.sections.off("close", this.close, this);
      this.sections.off("visibility", this.visibility, this); this.sections.off("change", this.rename, this);
      this.handle.space.off("change", this.render, this); setSectionPlane(this.handle.app, null);
    };
    this.handle.app.on("destroy", detach);
    this.render(); return detach;
  }
  enter() { if (!this.state.reference) this.fromCamera(); this.history = [this.snapshot()]; this.cursor = 0; }
  leave() {
    this.pending = null;
    const saved = this.sections.records.find(record => record.id === this.sections.activeId);
    if (saved) this.apply(saved); else Object.assign(this.state, { editing: null, name: "", reference: null,
      source: "camera", alignment: "view", enabled: false, options: { ...defaultSectionOptions } });
    this.render();
  }
  private snapshot() { return { ...this.state, reference: this.state.reference ? copyFrame(this.state.reference) : null, options: { ...this.state.options } }; }
  begin() { this.pending ??= this.snapshot(); }
  commit() {
    if (!this.pending) return;
    this.history.splice(this.cursor + 1); this.history[this.cursor] = this.pending;
    this.history.push(this.snapshot()); this.cursor++; this.pending = null;
  }
  undo() { if (this.cursor > 0) { Object.assign(this.state, this.history[--this.cursor]); this.render(); } }
  redo() { if (this.cursor + 1 < this.history.length) { Object.assign(this.state, this.history[++this.cursor]); this.render(); } }
  options(options: Partial<SectionOptions>) {
    if ((Object.keys(options) as (keyof SectionOptions)[]).every(key => options[key] === this.state.options[key])) return;
    const grouped = !!this.pending; if (!grouped) this.begin();
    this.state.options = { ...this.state.options, ...options }; this.render();
    if (!grouped) this.commit();
  }
  name(value: string) { this.state.name = value; this.fire("change"); }
  fromCamera() { this.useReference(this.adapter.capture().frame, "camera"); }
  private useReference(reference: ViewFrame, source: string) {
    this.state.reference = copyFrame(reference); this.state.source = source;
    this.state.alignment = "view"; this.state.options = { ...defaultSectionOptions }; this.render();
  }
  chooseView(id: string) {
    const view = this.views.records.find(view => String(view.id) === id);
    if (view) { this.adapter.restore(view); this.useReference(view.frame, id); }
  }
  align(axis: ViewAxis | "view") {
    this.begin(); this.state.alignment = axis; this.state.options = { ...defaultSectionOptions }; this.render(); this.commit(); this.look();
  }
  look() { const frame = this.frame; if (frame) this.adapter.look(cutawayView(frame, this.state.options.flip)); }
  enable(value: boolean) { this.state.enabled = value; this.render(); }
  showPlane(value: boolean) { this.state.showPlane = value; this.fire("change"); }
  save() {
    const s = this.state;
    if (!s.enabled || !s.reference || !s.name.trim()) return;
    this.sections.save({ id: s.editing ?? undefined, name: s.name.trim(), reference: copyFrame(s.reference), source: s.source,
      alignment: s.alignment, options: { ...s.options }, view: this.adapter.capture() });
    s.name = ""; s.editing = null; this.fire("change");
  }
  fresh() { this.state.editing = null; this.state.name = ""; this.fire("change"); }
  private apply(section: NamedSection) {
    Object.assign(this.state, { editing: section.id, name: section.name, reference: copyFrame(section.reference), source: section.source,
      alignment: section.alignment, options: { ...section.options }, enabled: true });
  }
  private open(section: NamedSection) { this.adapter.restore(section.view); this.apply(section); this.render(); }
  private close() { this.state.enabled = false; this.state.editing = null; this.state.name = ""; this.render(); }
  private visibility(section: NamedSection | null) { if (section) this.apply(section); else this.state.enabled = false; this.render(); }
  private rename() {
    const saved = this.sections.records.find(item => item.id === this.state.editing);
    if (saved) this.state.name = saved.name;
    this.fire("change");
  }
  private render() {
    if (!this.attached) return;
    const frame = this.frame;
    const plane = this.state.enabled && frame ? planeCoefficients(frame, this.state.options.flip) : null;
    if (this.lastPlane === undefined || (!!plane !== !!this.lastPlane) ||
        (plane && this.lastPlane && plane.some((value, index) => value !== this.lastPlane![index]))) {
      this.lastPlane = plane;
      setSectionPlane(this.handle.app, plane); this.handle.selection.updateSection();
    }
    this.fire("change");
  }
}
