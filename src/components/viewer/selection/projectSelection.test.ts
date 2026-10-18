import { describe, expect, it } from "vitest";
import { Mat4 } from "playcanvas";
import { projectSelection } from "./projectSelection";
import { decodeDepth, depthTest } from "./SelectionDepth";
import { triangleCenters } from "./MeshSelection";

const region = { pixels: new Uint8ClampedArray(4 * 4 * 4).fill(255), width: 4, height: 4 };
const projection = new Mat4().setPerspective(45, 1, 0.1, 10).data;
const centers = new Float32Array([0, 0, -1, 0, 0, -2, 0, 0, 1, 0, 0, -11]);

describe("region selection", () => {
  it("uses rasterized shape coverage rather than its bounding rectangle", () => {
    const pixels = region.pixels.slice(); pixels[(2 * 4 + 2) * 4 + 3] = 0;
    expect(projectSelection(centers, new Uint8Array(4), projection, { ...region, pixels }, "set", false)).toBe(0);
  });
  it("excludes occluded centers, while X-ray includes them", () => {
    const mask = new Uint8Array(4);
    expect(projectSelection(centers, mask, projection, region, "set", false)).toBe(2);
    const depth = { width: 100, height: 100, values: new Float32Array(10000).fill((1 - .1) / 9.9), near: .1, far: 10, orthographic: false };
    expect(projectSelection(centers, mask, projection, region, "set", false, depthTest(depth))).toBe(1);
    expect([...mask]).toEqual([255, 0, 0, 0]);
    depth.values.fill(NaN);
    expect(projectSelection(centers, mask, projection, region, "set", false, depthTest(depth))).toBe(0);
  });
  it("preserves isolation and modifier semantics", () => {
    const mask = new Uint8Array([0, 255, 0, 0]);
    expect(projectSelection(centers, mask, projection, region, "add", true)).toBe(1);
    expect(projectSelection(centers, mask, projection, region, "add", false)).toBe(2);
    expect(projectSelection(centers, mask, projection, region, "intersect", false)).toBe(2);
    expect(projectSelection(centers, mask, projection, region, "remove", false)).toBe(0);
  });
});

it("decodes PlayCanvas packed floating-point depth and framebuffer orientation", () => {
  const data = new Uint8Array(8), view = new DataView(data.buffer);
  view.setFloat32(0, .25); view.setUint32(4, 0xffffffff);
  const depth = decodeDepth(data, 1, 2, true);
  expect(Number.isNaN(depth[0])).toBe(true); expect(depth[1]).toBe(.25);
});

it("computes triangle centers from normalized quantized positions", () => {
  const positions = [-32768, 0, 0, 32767, 0, 0, 0, 32767, 0];
  const centers = triangleCenters(positions, [0, 1, 2], 32767, true);
  expect(centers[0]).toBe(0); expect(centers[1]).toBeCloseTo(1 / 3); expect(centers[2]).toBe(0);
});
