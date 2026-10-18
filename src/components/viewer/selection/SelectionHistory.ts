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
  private snapshots: SelectionSnapshot[];
  private cursor = 0;
  constructor(private readonly selection: Pick<SelectionController, "state" | "restore" | "summary">) { this.snapshots = [packSelection(selection.state)]; }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor + 1 < this.snapshots.length; }
  perform(action: () => SelectionSummary): SelectionSummary {
    const summary = action(), next = packSelection(this.selection.state);
    if (!equal(this.snapshots[this.cursor]!, next)) {
      this.snapshots.splice(++this.cursor);
      this.snapshots.push(next);
    }
    return summary;
  }
  undo(): SelectionSummary {
    if (this.canUndo) return this.selection.restore(unpackSelection(this.snapshots[--this.cursor]!));
    return this.selection.summary;
  }
  redo(): SelectionSummary {
    if (this.canRedo) return this.selection.restore(unpackSelection(this.snapshots[++this.cursor]!));
    return this.selection.summary;
  }
}
