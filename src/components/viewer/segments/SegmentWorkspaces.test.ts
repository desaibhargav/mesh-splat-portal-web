import { expect, it, vi } from "vitest";
import { Quat, Vec3 } from "playcanvas";
import { SegmentWorkspaces } from "./SegmentWorkspaces";
import { packSelection } from "../selection/selectionSnapshot";
import { constrainMask, type SelectionScope } from "../selection/selectionScope";
import type { SelectionHandle, SelectionState, SelectionArea } from "../selection/types";
import type { PaintState } from "../selection/selectionColors";

vi.mock("../views/viewFrame", () => ({ captureFrame: () => ({}), recallFrame: vi.fn() }));
function setup() {
  let scope: SelectionScope = null;
  const selection = {
    state: { masks: [new Uint8Array([255, 0, 0, 0])], isolated: false },
    colors: [new Uint32Array([4, 0, 0, 0])] as PaintState, areas: [] as readonly SelectionArea[],
    get summary() { return { selected: this.state.masks[0]!.filter(Boolean).length, total: 4, isolated: this.state.isolated }; },
    restore(state: SelectionState, colors?: PaintState, areas?: readonly SelectionArea[], nextScope = scope) {
      scope = nextScope; this.state = { masks: state.masks.map(mask => mask.slice()), isolated: state.isolated };
      this.state.masks.forEach((mask, part) => constrainMask(mask, scope?.[part]));
      this.colors = colors ?? this.colors; this.areas = areas ?? this.areas; return this.summary;
    }
  };
  const handle = { selection, space: { rotation: new Quat(), setRotation: vi.fn() }, viewports: { panels: [] } } as unknown as SelectionHandle;
  return { selection, workspaces: new SegmentWorkspaces(handle), scope: () => scope };
}
const region = (values: number[]) => packSelection({ masks: [new Uint8Array(values)], isolated: false });

it("scopes geometry while keeping parent and segment tool documents and histories independent", () => {
  const { selection, workspaces, scope } = setup();
  const original = selection.colors;
  const parentHistory = workspaces.history;
  workspaces.asset.measurement.add(new Vec3()); workspaces.asset.annotations.save({ title: "Parent", text: "", position: new Vec3(), region: null });
  const segment = workspaces.create("Part", region([255, 255, 0, 0]));
  expect([...scope()![0]!]).toEqual([255, 255, 0, 0]);
  expect(workspaces.history).not.toBe(parentHistory);
  expect(segment.measurement.records).toHaveLength(0); expect(segment.annotations.records).toHaveLength(0);
  workspaces.history.perform(() => selection.restore({ masks: [new Uint8Array([255, 255, 255, 255])], isolated: true }, [new Uint32Array([7, 7, 0, 0])]));
  segment.measurement.add(new Vec3(1, 2, 3));
  expect([...selection.state.masks[0]!]).toEqual([255, 255, 0, 0]);
  workspaces.open(0);
  expect(scope()).toBeNull(); expect(selection.colors).toBe(original);
  expect(workspaces.history).toBe(parentHistory); expect(workspaces.asset.measurement.records).toHaveLength(1);
  workspaces.open(segment.id);
  expect([...selection.colors[0]!]).toEqual([7, 7, 0, 0]); expect(segment.measurement.points[0]!.x).toBe(1);
  workspaces.history.undo(); expect(selection.summary.selected).toBe(0);
  expect(workspaces.asset.annotations.records[0]!.title).toBe("Parent");
});

it("hides only the active segment without changing its saved scope or opening another tool", () => {
  const { selection, workspaces, scope } = setup();
  const segment = workspaces.create("Part", region([255, 0, 0, 0]));
  const open = vi.fn(); workspaces.on("open", open);
  workspaces.setVisible(segment.id, false); expect(scope()![0]!.some(Boolean)).toBe(false);
  workspaces.setVisible(segment.id, true); expect([...scope()![0]!]).toEqual([255, 0, 0, 0]);
  workspaces.rename(segment.id, "Renamed"); expect(segment.name).toBe("Renamed"); expect(open).not.toHaveBeenCalled();
  workspaces.remove(segment.id); expect(workspaces.current).toBe(workspaces.asset); expect(selection.colors[0]![0]).toBe(4);
});

it("rejects empty, foreign-geometry, and out-of-workspace segment regions", () => {
  const { workspaces } = setup();
  expect(() => workspaces.create("", region([255, 0, 0, 0]))).toThrow("Name");
  expect(() => workspaces.create("Empty", region([0, 0, 0, 0]))).toThrow("select");
  expect(() => workspaces.create("Other", region([255]))).toThrow("geometry");
  workspaces.create("First", region([255, 0, 0, 0]));
  expect(() => workspaces.create("Outside", region([0, 255, 0, 0]))).toThrow("within");
});
