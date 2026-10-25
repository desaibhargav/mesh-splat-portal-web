import { describe, expect, it } from "vitest";
import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { MeshVisibilityQuery } from "./MeshVisibilityQuery";
import type { VisibilityGeometry, VisibilityQuery } from "./visibilityTypes";

const identity = new Matrix4().toArray();
function geometry(points: number[]): VisibilityGeometry {
  return { positions: Float32Array.from(points), indices: Uint32Array.from({ length: points.length / 3 }, (_, i) => i) };
}
const target = geometry([-.8, -.8, 0, .8, -.8, 0, 0, .8, 0]);
function rectangle(left: number, right: number, depth = .2) {
  return [left, -1, depth, right, -1, depth, right, 1, depth, left, -1, depth, right, 1, depth, left, 1, depth];
}
function query(parts: VisibilityGeometry[], perspective = false): VisibilityQuery {
  const camera = perspective ? new PerspectiveCamera(60, 1, .1, 10) : new OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.z = 2; camera.updateMatrixWorld();
  return { projection: camera.projectionMatrix.toArray(), view: camera.matrixWorldInverse.toArray(), section: null,
    width: 32, height: 32, alpha: new Uint8Array(1024).fill(255), hits: parts.map(p => new Uint8Array(p.indices.length / 3)),
    parts: parts.map(() => ({ model: identity, side: 2, visible: null })) };
}
function select(parts: VisibilityGeometry[], input = query(parts)) {
  return new MeshVisibilityQuery(parts).select(input);
}

describe("accelerated centroid visibility supplement", () => {
  it("selects a subpixel triangle without requiring a raster sample", () => {
    const tiny = geometry([0, 0, 0, .0001, 0, 0, 0, .0001, 0]);
    expect(select([tiny])[0]![0]).toBe(255);
  });
  it.each([false, true])("retains GPU coverage of partially visible faces whose centers are occluded (perspective=%s)", perspective => {
    const occluders = geometry([...rectangle(-1, .15), ...rectangle(.2, 1)]);
    const input = query([target, occluders], perspective);
    expect(select([target, occluders], input)[0]![0]).toBe(0);
    input.hits[0]![0] = 255;
    expect(select([target, occluders], input)[0]![0]).toBe(255);
  });
  it("rejects genuinely hidden faces across different mesh parts", () => {
    expect(select([target, geometry(rectangle(-1, 1))])[0]![0]).toBe(0);
  });
  it("does not treat a very close occluder as a depth tie", () => {
    expect(select([target, geometry(rectangle(-1, 1, 1e-7))])[0]![0]).toBe(0);
  });
  it("does not let removed section surfaces occlude retained faces", () => {
    const parts = [target, geometry(rectangle(-1, 1))], input = query(parts);
    input.section = [0, 0, -1, 0];
    const result = select(parts, input);
    expect(result[0]![0]).toBe(255); expect(result[1]!.some(Boolean)).toBe(false);
  });
  it("ignores out-of-scope faces as both targets and occluders", () => {
    const parts = [target, geometry(rectangle(-1, 1))], input = query(parts);
    input.parts[1]!.visible = new Uint8Array(2);
    const result = select(parts, input);
    expect(result[0]![0]).toBe(255); expect(result[1]!.some(Boolean)).toBe(false);
  });
  it("respects a region that excludes the triangle", () => {
    const input = query([target]); input.alpha.fill(0); input.alpha[0] = 255;
    expect(select([target], input)[0]![0]).toBe(0);
  });
  it("retains native GPU hits", () => {
    const input = query([target]); input.hits[0]![0] = 255; input.alpha.fill(0);
    expect(select([target], input)[0]![0]).toBe(255);
  });
  it("respects front/back culling and mirrored, nonuniform model transforms", () => {
    const input = query([target]);
    input.parts[0]!.model = new Matrix4().makeScale(-.5, .75, 2).toArray();
    input.parts[0]!.side = 1;
    expect(select([target], input)[0]![0]).toBe(0);
    input.parts[0]!.side = 0;
    expect(select([target], input)[0]![0]).toBe(255);
  });
  it("starts visibility rays at the near plane", () => {
    const parts = [target, geometry(rectangle(-1, 1, 1.95))];
    const result = select(parts);
    expect(result[0]![0]).toBe(255); expect(result[1]!.some(Boolean)).toBe(false);
  });
});

it("picks the exact transformed surface and ignores cut or hidden foreground faces", () => {
  const parts = [target, geometry(rectangle(-1, 1, .2))], bvh = new MeshVisibilityQuery(parts);
  const model = new Matrix4().makeRotationY(.4).setPosition(1, 2, -3).scale(new Vector3(.3, .8, .5));
  const origin = new Vector3(0, 0, 2).applyMatrix4(model), direction = new Vector3(0, 0, -1).transformDirection(model);
  const input = { origin: origin.toArray(), direction: direction.toArray(), section: null as number[] | null,
    parts: parts.map(() => ({ model: model.toArray(), side: 2 as const })) };
  const front = new Vector3(0, 0, .2).applyMatrix4(model);
  expect(new Vector3().fromArray(bvh.raycast(input, [null, null])!).distanceTo(front)).toBeLessThan(1e-6);
  const back = new Vector3(0, 0, 0).applyMatrix4(model);
  expect(new Vector3().fromArray(bvh.raycast(input, [null, new Uint8Array(2)])!).distanceTo(back)).toBeLessThan(1e-6);
  const normal = new Vector3(0, 0, -1).transformDirection(model);
  input.section = [...normal.toArray(), -normal.dot(back) + .01];
  expect(new Vector3().fromArray(bvh.raycast(input, [null, null])!).distanceTo(back)).toBeLessThan(1e-6);
});
