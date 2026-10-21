import { Quat } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { captureFrame, copyFrame, recallFrame, type ViewFrame } from "./viewFrame";

interface ViewState { rotation: Quat; frames: Map<string, ViewFrame> }

function same(a: ViewState, b: ViewState) {
  if (!a.rotation.equals(b.rotation) || a.frames.size !== b.frames.size) return false;
  for (const [id, x] of a.frames) {
    const y = b.frames.get(id);
    if (!y || !x.origin.equals(y.origin) || !x.rotation.equals(y.rotation) || x.distance !== y.distance ||
      x.fov !== y.fov || x.projection !== y.projection || x.orthoHeight !== y.orthoHeight) return false;
  }
  return true;
}

// One history owns the asset orientation and every viewport camera so an undo
// is an atomic scene-view operation rather than a tool-specific exception.
export class ViewHistory {
  private snapshots: ViewState[];
  private cursor = 0;
  private pending: ViewState | null = null;
  constructor(private readonly handle: SelectionHandle) { this.snapshots = [this.capture()]; }
  reset() { this.snapshots = [this.capture()]; this.cursor = 0; this.pending = null; }
  begin() { this.pending ??= this.capture(); }
  commit() {
    const before = this.pending; this.pending = null;
    const after = this.capture();
    if (!before || same(before, after)) return;
    this.snapshots.splice(this.cursor + 1);
    if (!same(this.snapshots[this.cursor]!, before)) this.snapshots[this.cursor] = before;
    this.snapshots.push(after); this.cursor++;
  }
  perform(action: () => void) { this.begin(); action(); this.commit(); }
  undo() { if (this.cursor > 0) this.restore(this.snapshots[--this.cursor]!); }
  redo() { if (this.cursor + 1 < this.snapshots.length) this.restore(this.snapshots[++this.cursor]!); }
  private capture(): ViewState {
    return { rotation: this.handle.space.rotation,
      frames: new Map(this.handle.viewports.panels.map(panel => [panel.id, captureFrame(panel.camera)])) };
  }
  private restore(state: ViewState) {
    this.handle.space.setRotation(state.rotation);
    for (const panel of this.handle.viewports.panels) {
      const frame = state.frames.get(panel.id); if (frame) recallFrame(panel.camera, copyFrame(frame));
    }
    this.handle.viewports.refresh();
  }
}
