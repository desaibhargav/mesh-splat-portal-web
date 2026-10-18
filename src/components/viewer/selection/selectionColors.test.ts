import { expect, it } from "vitest";
import { paintSelection } from "./selectionColors";

it("paints only selected primitives and keeps previous color buffers immutable", () => {
  const original = [new Uint8Array([0, 1, 0]), new Uint8Array([0, 0])];
  const next = paintSelection(original, [new Uint8Array([255, 0, 255]), new Uint8Array(2)], 2);
  expect([...next[0]!]).toEqual([2, 1, 2]); expect([...original[0]!]).toEqual([0, 1, 0]);
  expect(next[1]).toBe(original[1]);
  expect(paintSelection(next, [new Uint8Array([255, 0, 255]), new Uint8Array(2)], 2)).toBe(next);
  expect([...paintSelection(next, [new Uint8Array([0, 255, 0]), new Uint8Array(2)], 0)[0]!]).toEqual([2, 0, 2]);
  expect(() => paintSelection(original, [], -1)).toThrow("Unknown selection color");
});
