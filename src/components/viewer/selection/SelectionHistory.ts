import type { PaintState } from "./selectionColors";
import type { SelectionController, SelectionState, SelectionSummary } from "./types";

export interface SelectionSnapshot { masks: { bits: Uint8Array; length: number }[]; isolated: boolean }
export function packSelection(state: SelectionState): SelectionSnapshot {
  return { isolated: state.isolated, masks: state.masks.map(mask => {
    const bits = new Uint8Array(Math.ceil(mask.length / 8));
    mask.forEach((value, i) => { if (value) bits[i >> 3]! |= 1 << (i & 7); });
    return { bits, length: mask.length };
  }) };
}
export function unpackSelection(snapshot: SelectionSnapshot): SelectionState {
  return { isolated: snapshot.isolated, masks: snapshot.masks.map(({ bits, length }) =>
    Uint8Array.from({ length }, (_, i) => bits[i >> 3]! & (1 << (i & 7)) ? 255 : 0)) };
}
function equal(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return a.isolated === b.isolated && a.masks.every((mask, i) => mask.bits.every((value, j) => value === b.masks[i]!.bits[j]));
}

// Bit-packed masks use one bit per primitive, and no-op gestures create no history entry.
export class SelectionHistory {
  private snapshots: { selection: SelectionSnapshot; colors: PaintState }[];
  private cursor = 0;
  constructor(private readonly selection: Pick<SelectionController, "state" | "restore" | "summary" | "colors">) { this.snapshots = [{ selection: packSelection(selection.state), colors: selection.colors }]; }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor + 1 < this.snapshots.length; }
  perform(action: () => SelectionSummary): SelectionSummary {
    const summary = action(), next = { selection: packSelection(this.selection.state), colors: this.selection.colors };
    if (this.snapshots[this.cursor]!.colors !== next.colors || !equal(this.snapshots[this.cursor]!.selection, next.selection)) {
      this.snapshots.splice(++this.cursor);
      this.snapshots.push(next);
    }
    return summary;
  }
  private restore(index: number): SelectionSummary {
    const snapshot = this.snapshots[index]!;
    return this.selection.restore(unpackSelection(snapshot.selection), snapshot.colors);
  }
  undo(): SelectionSummary {
    if (this.canUndo) return this.restore(--this.cursor);
    return this.selection.summary;
  }
  redo(): SelectionSummary {
    if (this.canRedo) return this.restore(++this.cursor);
    return this.selection.summary;
  }
}
