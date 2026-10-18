import { expect, it } from "vitest";
import { decodeColor, encodeColor, paintSelection, selectionShade } from "./selectionColors";

it("paints only selected primitives and keeps previous color buffers immutable", () => {
  const original = [new Uint32Array([0, 1, 0]), new Uint32Array([0, 0])];
  const next = paintSelection(original, [new Uint8Array([255, 0, 255]), new Uint8Array(2)], 2);
  expect([...next[0]!]).toEqual([2, 1, 2]); expect([...original[0]!]).toEqual([0, 1, 0]);
  expect(next[1]).toBe(original[1]);
  expect(paintSelection(next, [new Uint8Array([255, 0, 255]), new Uint8Array(2)], 2)).toBe(next);
  expect([...paintSelection(next, [new Uint8Array([0, 255, 0]), new Uint8Array(2)], 0)[0]!]).toEqual([2, 0, 2]);
  expect(() => paintSelection(original, [], -1)).toThrow("Unknown selection color");
});

it("round-trips arbitrary shades and chooses the dominant selected shade", () => {
  const blue = encodeColor("#147daa"), red = encodeColor("#e53935");
  expect(decodeColor(blue)).toBe("#147daa");
  expect(selectionShade([new Uint32Array([blue, red, blue, 0])], [new Uint8Array([255, 255, 255, 0])], "#gold"))
    .toBe("#147daa");
  expect(selectionShade([new Uint32Array(2)], [new Uint8Array([255, 255])], "#d7bc77")).toBe("#d7bc77");
  expect(() => encodeColor("red")).toThrow("six-digit hex");
});
