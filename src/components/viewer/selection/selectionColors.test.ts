import { expect, it } from "vitest";
import { currentSelectionArea, decodeColor, encodeColor, paintSelection, recordSelectionArea, recordSelectionGesture, updateSelectionAreas, visiblePaint, visibleSelections } from "./selectionColors";

it("paints only selected primitives and keeps previous color buffers immutable", () => {
  const original = [new Uint32Array([0, 1, 0]), new Uint32Array([0, 0])];
  const next = paintSelection(original, [new Uint8Array([255, 0, 255]), new Uint8Array(2)], 2);
  expect([...next[0]!]).toEqual([2, 1, 2]); expect([...original[0]!]).toEqual([0, 1, 0]);
  expect(next[1]).toBe(original[1]);
  expect(paintSelection(next, [new Uint8Array([255, 0, 255]), new Uint8Array(2)], 2)).toBe(next);
  expect([...paintSelection(next, [new Uint8Array([0, 255, 0]), new Uint8Array(2)], 0)[0]!]).toEqual([2, 0, 2]);
  expect(() => paintSelection(original, [], -1)).toThrow("Unknown selection color");
});

it("round-trips arbitrary shades", () => {
  const blue = encodeColor("#147daa");
  expect(decodeColor(blue)).toBe("#147daa");
  expect(() => encodeColor("red")).toThrow("six-digit hex");
});

it("keeps an earlier painted area when a later selection overlaps it", () => {
  const blue = encodeColor("#0000ff"), red = encodeColor("#ff0000");
  const colors = [new Uint32Array([blue, 0])], masks = [new Uint8Array([255, 255])];
  expect([...paintSelection(colors, masks, red)[0]!]).toEqual([blue, red]);
  const areas = updateSelectionAreas([], colors, masks, red);
  expect([...areas[0]!.snapshot.masks[0]!.bits]).toEqual([2]);
  expect([...currentSelectionArea({ masks, isolated: false }, areas)!.snapshot.masks[0]!.bits]).toEqual([1]);
});

it("recolors one existing selection without overriding an earlier overlap", () => {
  const blue = encodeColor("#0000ff"), red = encodeColor("#ff0000"), purple = encodeColor("#800080");
  const colors = [new Uint32Array([blue, red, red])], selected = [new Uint8Array([255, 255, 255])];
  expect([...paintSelection(colors, selected, purple, red)[0]!]).toEqual([blue, purple, purple]);
  expect([...paintSelection(colors, selected, 0, red)[0]!]).toEqual([blue, 0, 0]);
  const area = updateSelectionAreas(recordSelectionArea([], { masks: selected, isolated: false }), colors, selected, purple);
  expect(area[0]!.color).toBe(purple);
});

it("records every selection and independently hides its highlight and paint", () => {
  const red = encodeColor("#ff0000"), state = { masks: [new Uint8Array([255, 0])], isolated: false };
  const recorded = recordSelectionArea([], state);
  expect(recorded[0]).toMatchObject({ name: "Selection 1", visible: true, color: 0 });
  expect([...visibleSelections(recorded, [2])[0]!]).toEqual([255, 0]);
  const painted = updateSelectionAreas(recorded, [new Uint32Array(2)], state.masks, red);
  const hidden = painted.map(area => ({ ...area, visible: false }));
  expect([...visiblePaint([new Uint32Array([red, 0])], hidden)[0]!]).toEqual([0, 0]);
  expect([...visibleSelections(hidden, [2])[0]!]).toEqual([0, 0]);
});

it("records only the area added by each selection gesture", () => {
  const first = { masks: [new Uint8Array([255, 0, 0])], isolated: false };
  const combined = { masks: [new Uint8Array([255, 255, 0])], isolated: false };
  const areas = recordSelectionGesture(recordSelectionGesture([], first, "set"), combined, "add", first.masks);
  expect([...areas[0]!.snapshot.masks[0]!.bits]).toEqual([1]);
  expect([...areas[1]!.snapshot.masks[0]!.bits]).toEqual([2]);
});
