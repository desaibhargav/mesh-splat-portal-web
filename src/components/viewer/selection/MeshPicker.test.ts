import { expect, it } from "vitest";
import { facesInRegion, selectionPickScale } from "./MeshPicker";
import { applySelection } from "./projectSelection";

function image(ids: number[], width: number, height: number) {
  const pixels = new Uint8Array(ids.length * 4);
  ids.forEach((id, i) => { for (let byte = 0; byte < 4; byte++) pixels[i * 4 + byte] = (id >>> (byte * 8)) & 255; });
  return { pixels, left: 0, top: 0, width, height, screenWidth: width, screenHeight: height, flipY: false };
}
function region(alpha: number[], width: number) {
  const pixels = new Uint8ClampedArray(alpha.length * 4);
  alpha.forEach((value, i) => { pixels[i * 4 + 3] = value; });
  return { pixels, width, height: alpha.length / width };
}
it("maps global triangle IDs to mesh parts without selecting background or duplicate pixels twice", () => {
  const result = facesInRegion(image([0, 3, 3, 0xffffffff, 1, 4], 3, 2), region([255, 255, 255, 255, 255, 255], 3), [2, 3]);
  expect(result.map(mask => [...mask])).toEqual([[255, 255], [0, 255, 255]]);
});
it("applies lasso/brush coverage, framebuffer orientation, cropping and device pixel ratio", () => {
  const source = image([3, 2, 1, 0], 2, 2); source.flipY = true;
  const mask = region([255, 0, 0, 255], 2);
  expect([...facesInRegion(source, mask, [4])[0]!]).toEqual([0, 255, 255, 0]);
  const highDpi = image([0, 0, 1, 1], 4, 1);
  expect([...facesInRegion(highDpi, region([0, 255], 2), [2])[0]!]).toEqual([0, 255]);
  const crop = { ...image([1], 1, 1), left: 1, top: 1, screenWidth: 2, screenHeight: 2 };
  expect([...facesInRegion(crop, mask, [2])[0]!]).toEqual([0, 255]);
});
it("selects any face with a covered pixel, even when its centroid lies outside the gesture", () => {
  const hits = facesInRegion(image([0, 0xffffffff], 2, 1), region([255, 0], 2), [1])[0]!;
  const mask = new Uint8Array(1);
  expect(applySelection(mask, hits, "set", false)).toBe(1);
});
it("keeps add/remove/intersection and isolation semantics for GPU face masks", () => {
  const mask = new Uint8Array([255, 0, 255]), hits = new Uint8Array([0, 255, 255]);
  expect(applySelection(mask, hits, "add", true)).toBe(2);
  expect([...mask]).toEqual([255, 0, 255]);
  expect(applySelection(mask, hits, "add", false)).toBe(3);
  expect(applySelection(mask, hits, "intersect", false)).toBe(2);
  expect(applySelection(mask, hits, "remove", false)).toBe(0);
});

it("bounds selection supersampling by texture limits and a pixel budget without reducing native resolution", () => {
  expect(selectionPickScale(400, 300, 4096)).toBe(4);
  const scale = selectionPickScale(1200, 800, 4096);
  expect(1200 * 800 * scale * scale).toBeCloseTo(4 * 1024 * 1024);
  expect(selectionPickScale(3840, 2160, 8192)).toBe(1);
  expect(selectionPickScale(1200, 800, 2048)).toBeLessThanOrEqual(2048 / 1200);
});
