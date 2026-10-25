import { expect, it } from "vitest";
import { Matrix4 } from "three";
import { PointSurfaceQuery } from "./PointSurfaceQuery";

it("preserves source point IDs and filters hidden and sectioned foreground points", () => {
  const query = new PointSurfaceQuery(new Float32Array([0, 0, -1, 0, 0, -2, 1, 0, -1]));
  const ray = { origin: [0, 0, 0], direction: [0, 0, -1], parts: [{ model: new Matrix4().toArray(), side: 2 as const }], section: null as number[] | null };
  expect(query.surfaceHit(ray, [null])).toMatchObject({ index: 0, point: [0, 0, -1] });
  expect(query.surfaceHit(ray, [new Uint8Array([0, 255, 255])])).toMatchObject({ index: 1 });
  ray.section = [0, 0, -1, -1.5];
  expect(query.surfaceHit(ray, [null])).toMatchObject({ index: 1 });
});
