import { expect, it } from "vitest";
import { currentSelectionArea, decodeColor, encodeColor, paintSelection, updateSelectionAreas } from "./selectionColors";

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
