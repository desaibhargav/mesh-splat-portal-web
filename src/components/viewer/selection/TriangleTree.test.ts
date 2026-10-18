import { expect, it } from "vitest";
import { CULLFACE_BACK, CULLFACE_NONE, Vec3 } from "playcanvas";
import { TriangleTree } from "./TriangleTree";
import { triangleCenters } from "./MeshSelection";

const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, -1, -1, -1, 1, -1, -1, 0, 1, -1]);
const indices = [0, 1, 2, 3, 4, 5];
it("selects visible subpixel triangles while excluding occluded triangles", () => {
  for (const scale of [1, 1e-6, 1e6]) {
    const points = positions.map(value => value * scale), centers = triangleCenters(points, indices);
    const tree = new TriangleTree(points, indices, centers, CULLFACE_BACK, 1);
    const origin = new Vec3(0, -scale / 3, 3 * scale);
    const front = new Vec3(0, 0, -3 * scale), back = new Vec3(0, 0, -4 * scale);
    expect(tree.facing(0, origin, front)).toBe(true);
    expect(tree.occludes(origin, front, 0)).toBe(false);
    expect(tree.occludes(origin, back, 0)).toBe(true);
    expect(tree.occludes(origin, back, 0, new Uint8Array([0, 255]))).toBe(false);
    expect(tree.occludes(origin, back, .8)).toBe(false);
  }
});
it("respects backface culling and rays parallel to a bounding-box slab", () => {
  const tree = new TriangleTree(positions, indices, triangleCenters(positions, indices), CULLFACE_BACK);
  expect(tree.facing(0, new Vec3(0, 0, -2), new Vec3(0, -1 / 3, 2))).toBe(false);
  expect(tree.occludes(new Vec3(10, 0, 3), new Vec3(0, 0, -4), 0)).toBe(false);
  const doubleSided = new TriangleTree(positions, indices, triangleCenters(positions, indices), CULLFACE_NONE);
  expect(doubleSided.occludes(new Vec3(0, 0, -2), new Vec3(0, 0, 4), 0)).toBe(true);
});

it("keeps every face of a dense sloped plane visible, including subpixel faces", () => {
  const positions: number[] = [], indices: number[] = [], size = 48;
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) positions.push(x / size, y / size, 3 * x / size + 2 * y / size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = y * (size + 1) + x, b = a + 1, c = a + size + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const points = Float32Array.from(positions), centers = triangleCenters(points, indices);
  const tree = new TriangleTree(points, indices, centers, CULLFACE_BACK);
  const origin = new Vec3(0, 0, 1000), direction = new Vec3();
  for (let face = 0; face < indices.length / 3; face++) {
    direction.set(centers[face * 3]!, centers[face * 3 + 1]!, centers[face * 3 + 2]!).sub(origin);
    expect(tree.facing(face, origin, direction)).toBe(true);
    expect(tree.occludes(origin, direction, 0)).toBe(false);
  }
});
