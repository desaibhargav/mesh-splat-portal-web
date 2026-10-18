import { expect, it } from "vitest";
import { SelectionHistory } from "./SelectionHistory";
import type { SelectionState } from "./types";
import { paintSelection } from "./selectionColors";

function setup() {
  const selection = {
    colors: [new Uint32Array(11), new Uint32Array(3)] as readonly Uint32Array[],
    state: { masks: [new Uint8Array(11), new Uint8Array(3)], isolated: false } as SelectionState,
    get summary() { return { selected: this.state.masks.reduce((sum, mask) => sum + mask.filter(Boolean).length, 0), total: 14, isolated: this.state.isolated }; },
    restore(state: SelectionState, colors?: readonly Uint32Array[]) { if (colors) this.colors = colors; this.state = state; return this.summary; }
  };
  return { selection, history: new SelectionHistory(selection) };
}
it("undoes and redoes selection, clear, and isolation across multiple meshes", () => {
  const { selection, history } = setup();
  history.perform(() => { selection.state.masks[0]![10] = 255; selection.state.masks[1]![2] = 255; return selection.summary; });
  history.perform(() => { selection.state.isolated = true; return selection.summary; });
  history.perform(() => { selection.state.masks.forEach(mask => mask.fill(0)); selection.state.isolated = false; return selection.summary; });
  expect(history.undo()).toMatchObject({ selected: 2, isolated: true });
  expect(history.undo()).toMatchObject({ selected: 2, isolated: false });
  expect(history.undo().selected).toBe(0); expect(history.canUndo).toBe(false);
  expect(history.redo().selected).toBe(2); expect(history.redo().isolated).toBe(true);
  expect(history.redo().selected).toBe(0); expect(history.canRedo).toBe(false);
});

it("undoes paint in order with selection edits, sharing unchanged paint buffers", () => {
  const { selection, history } = setup();
  history.perform(() => { selection.state.masks[0]![2] = 255; return selection.summary; });
  history.perform(() => { selection.colors = paintSelection(selection.colors, selection.state.masks, 1); return selection.summary; });
  const painted = selection.colors;
  history.perform(() => { selection.state.masks.forEach(mask => mask.fill(0)); return selection.summary; });
  history.undo(); expect(selection.colors).toBe(painted); expect(selection.summary.selected).toBe(1);
  history.undo(); expect(selection.colors[0]![2]).toBe(0); expect(selection.summary.selected).toBe(1);
  history.redo(); expect(selection.colors).toBe(painted);
});
it("ignores no-ops and replaces the redo branch after a new edit", () => {
  const { selection, history } = setup();
  history.perform(() => selection.summary); expect(history.canUndo).toBe(false);
  history.perform(() => { selection.state.masks[0]![0] = 255; return selection.summary; });
  history.undo(); expect(history.canRedo).toBe(true);
  history.perform(() => { selection.state.masks[0]![1] = 255; return selection.summary; });
  expect(history.canRedo).toBe(false); history.undo(); history.redo();
  expect([...selection.state.masks[0]!]).toEqual([0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
