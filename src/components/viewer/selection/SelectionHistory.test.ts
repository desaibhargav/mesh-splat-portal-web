import { expect, it } from "vitest";
import { SelectionHistory } from "./SelectionHistory";
import type { SelectionArea, SelectionState } from "./types";
import { paintSelection } from "./selectionColors";
import { packSelection } from "./selectionSnapshot";

interface MockSelection {
  colors: readonly Uint32Array[]; areas: readonly SelectionArea[]; state: SelectionState;
  readonly summary: { selected: number; total: number; isolated: boolean };
  restore(state: SelectionState, colors?: readonly Uint32Array[], areas?: readonly SelectionArea[]): MockSelection["summary"];
}

function setup() {
  let colors = [new Uint32Array(11), new Uint32Array(3)] as readonly Uint32Array[];
  let areas: readonly SelectionArea[] = [];
  let state = { masks: [new Uint8Array(11), new Uint8Array(3)], isolated: false } as SelectionState;
  const selection: MockSelection = {
    get colors() { return colors; }, set colors(value) { colors = value; },
    get areas() { return areas; }, set areas(value) { areas = value; },
    get state() { return state; }, set state(value) { state = value; },
    get summary() { return { selected: state.masks.reduce((sum, mask) => sum + mask.filter(Boolean).length, 0), total: 14, isolated: state.isolated }; },
    restore(nextState: SelectionState, nextColors = colors, nextAreas = areas) {
      colors = nextColors; areas = nextAreas; state = nextState; return this.summary;
    }
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

it("restores persistent colored areas with paint history", () => {
  const { selection, history } = setup();
  const area = { id: 1, name: "Selection 1", visible: true, color: 2,
    snapshot: packSelection({ masks: [new Uint8Array([255]), new Uint8Array(1)], isolated: false }) };
  history.perform(() => { selection.areas = [area]; return selection.summary; });
  expect(selection.areas).toEqual([area]);
  history.undo(); expect(selection.areas).toEqual([]);
  history.redo(); expect(selection.areas).toEqual([area]);
});
