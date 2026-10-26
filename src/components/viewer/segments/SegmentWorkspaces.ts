import { EventHandler, type Quat } from "playcanvas";
import { Annotations } from "../annotations/Annotations";
import { Measurement } from "../measurement/Measurement";
import { SavedPresets } from "../presets/SavedPresets";
import type { NamedSection, SectionSession } from "../section/SectionControls";
import { SelectionHistory } from "../selection/SelectionHistory";
import { packSelection, unpackSelection } from "../selection/selectionSnapshot";
import type { PaintState } from "../selection/selectionColors";
import { paintSelection } from "../selection/selectionColors";
import type { SelectionArea, SelectionHandle, SelectionSnapshot } from "../selection/types";
import { captureFrame, recallFrame, type NamedView } from "../views/viewFrame";

export class WorkspaceDocument {
  readonly annotations = new Annotations();
  readonly measurement = new Measurement();
  readonly sectionSession: SectionSession = {};
  readonly sections = new SavedPresets<NamedSection>();
  history?: SelectionHistory;
  areas: readonly SelectionArea[] = [];
  visible = true;
  color = 0;
  constructor(public readonly id: number, public name: string,
    readonly region: SelectionSnapshot | null, public selection: SelectionSnapshot, public colors: PaintState,
    readonly views: SavedPresets<NamedView>) {}
}

// Documents own edits; the viewer owns one set of geometry and GPU resources.
// Switching only uploads the active mask/paint and restores that document's tools.
export class SegmentWorkspaces extends EventHandler {
  readonly asset: WorkspaceDocument;
  readonly records: WorkspaceDocument[] = [];
  current: WorkspaceDocument;
  private readonly empty: SelectionSnapshot;
  private readonly emptyColors: PaintState;
  private readonly views = new SavedPresets<NamedView>();
  private nextId = 1;
  private readonly poses = new Map<number, { rotation: Quat;
    frames: Map<string, ReturnType<typeof captureFrame>> }>();
  constructor(private readonly handle: SelectionHandle) {
    super();
    const selection = handle.selection;
    this.empty = packSelection({ masks: selection.state.masks.map(mask => new Uint8Array(mask.length)), isolated: false });
    this.emptyColors = selection.colors.map(colors => new Uint32Array(colors.length));
    this.asset = this.current = new WorkspaceDocument(0, "Asset", null, packSelection(selection.state), selection.colors, this.views);
    this.asset.areas = selection.areas;
  }
  create(name: string, region: SelectionSnapshot) {
    if (region.masks.length !== this.empty.masks.length || region.masks.some((mask, part) => mask.length !== this.empty.masks[part]!.length)) {
      throw new Error("Segment geometry does not match this asset.");
    }
    if (this.current.region && region.masks.some((mask, part) => mask.bits.some((byte, i) => byte & ~this.current.region!.masks[part]!.bits[i]!))) {
      throw new Error("Create the segment within the current workspace.");
    }
    if (!name.trim() || !region.masks.some(mask => mask.bits.some(Boolean))) throw new Error("Name and select a segment first.");
    const record = new WorkspaceDocument(this.nextId++, name.trim(), region, this.empty, this.emptyColors, this.views);
    this.records.push(record); this.open(record.id); return record;
  }
  open(id: number) {
    const next = id === 0 ? this.asset : this.records.find(record => record.id === id);
    if (!next || next === this.current) return;
    this.capture(); this.current = next; next.visible = true;
    this.apply(); this.fire("open"); this.fire("change");
  }
  capture() {
    const selection = this.handle.selection;
    this.current.selection = packSelection(selection.state);
    this.current.colors = selection.colors; this.current.areas = selection.areas;
    this.poses.set(this.current.id, { rotation: this.handle.space.rotation,
      frames: new Map(this.handle.viewports.panels.map(panel => [panel.id, captureFrame(panel.camera)])) });
  }
  private apply(restorePose = true) {
    const { selection, space, viewports } = this.handle, document = this.current;
    const scope = document.region ? unpackSelection(document.region).masks : null;
    selection.restore(unpackSelection(document.selection), document.colors, document.areas,
      document.visible ? scope : this.empty.masks.map(mask => new Uint8Array(mask.length)));
    document.history ??= new SelectionHistory(selection);
    const pose = this.poses.get(document.id);
    if (pose && restorePose) {
      space.setRotation(pose.rotation);
      for (const panel of viewports.panels) {
        const frame = pose.frames.get(panel.id);
        if (frame) recallFrame(panel.camera, frame);
      }
    }
  }
  get history() { return this.current.history ??= new SelectionHistory(this.handle.selection); }
  removeSelection(id: number) {
    const selection = this.handle.selection, area = selection.areas.find(area => area.id === id);
    if (!area) return selection.summary;
    const colorMask = unpackSelection(area.snapshot).masks;
    for (const other of selection.areas) if (other.id !== id && other.color === area.color)
      unpackSelection(other.snapshot).masks.forEach((mask, part) => mask.forEach((selected, index) => {
        if (selected) colorMask[part]![index] = 0;
      }));
    const result = this.history.perform(() => selection.restore({ masks: selection.state.masks.map(mask => new Uint8Array(mask.length)), isolated: false },
      area.color ? paintSelection(selection.colors, colorMask, 0, area.color) : selection.colors,
      selection.areas.filter(item => item.id !== id)));
    this.current.annotations.removeForSelection(id, area.snapshot); this.fire("change"); return result;
  }
  setColor(color: number) {
    const document = this.current;
    if (!document.region || document.color === color) return;
    const masks = unpackSelection(document.region).masks;
    document.colors = paintSelection(document.colors, masks, color, document.color);
    document.color = color;
    this.handle.selection.restore(unpackSelection(document.selection), document.colors, document.areas, masks);
    document.history = new SelectionHistory(this.handle.selection);
    this.fire("change");
  }
  rename(id: number, name: string) {
    const record = this.records.find(record => record.id === id);
    if (!record || !name.trim()) return;
    record.name = name.trim(); this.fire("change");
  }
  setVisible(id: number, visible: boolean) {
    const record = this.records.find(record => record.id === id);
    if (!record || record.visible === visible) return;
    if (record === this.current && record.visible) this.capture();
    record.visible = visible;
    if (record === this.current) this.apply(false);
    this.fire("change");
  }
  remove(id: number) {
    const index = this.records.findIndex(record => record.id === id);
    if (index < 0) return;
    if (this.current.id === id) this.open(0);
    this.records.splice(index, 1); this.poses.delete(id); this.fire("change");
  }
}
