import type { PaintState } from "./selectionColors";
import { packSelection, selectionsEqual, unpackSelection } from "./selectionSnapshot";
import type { SelectionArea, SelectionController, SelectionSnapshot, SelectionSummary } from "./types";

export { packSelection, unpackSelection } from "./selectionSnapshot";
export type { SelectionSnapshot } from "./types";

// Bit-packed masks use one bit per primitive, and no-op gestures create no history entry.
export class SelectionHistory {
  private snapshots: { selection: SelectionSnapshot; colors: PaintState; areas: readonly SelectionArea[] }[];
  private cursor = 0;
  constructor(private readonly selection: Pick<SelectionController, "state" | "restore" | "summary" | "colors" | "areas">) {
    this.snapshots = [{ selection: packSelection(selection.state), colors: selection.colors, areas: selection.areas }];
  }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor + 1 < this.snapshots.length; }
  perform(action: () => SelectionSummary): SelectionSummary {
    const summary = action(), next = { selection: packSelection(this.selection.state), colors: this.selection.colors, areas: this.selection.areas };
    const current = this.snapshots[this.cursor]!;
    if (current.colors !== next.colors || current.areas !== next.areas || !selectionsEqual(current.selection, next.selection)) {
      this.snapshots.splice(++this.cursor);
      this.snapshots.push(next);
    }
    return summary;
  }
  private restore(index: number): SelectionSummary {
    const snapshot = this.snapshots[index]!;
    return this.selection.restore(unpackSelection(snapshot.selection), snapshot.colors, snapshot.areas);
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
