import { describe, expect, it } from "vitest";
import { MeshVisibilityQuery } from "../visibility/MeshVisibilityQuery";
import { PointSurfaceQuery } from "../visibility/PointSurfaceQuery";
import type { SelectionVolume } from "./SelectionVolume";

const frame = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rectangle: SelectionVolume = { shape: "rectangle", matrix: frame, outline: [[0, 0], [1, 0], [1, 1], [0, 1]], depth: 1 };
const state = { model: frame, side: 2 as const, visible: null };

describe("3D selection volumes", () => {
  it("selects intersecting mesh triangles at depth and excludes triangles beyond it", () => {
    const geometry = { positions: new Float32Array([
      .2, .2, .5, .8, .2, .5, .2, .8, .5,
      .2, .2, 1.5, .8, .2, 1.5, .2, .8, 1.5,
      -.5, .5, .5, .5, .5, .5, -.5, 1.5, .5
    ]), indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]) };
    const query = new MeshVisibilityQuery([geometry]);
    expect(Array.from(query.selectVolume({ volume: rectangle, parts: [state], section: null })[0]!)).toEqual([255, 0, 255]);
  });

  it("respects a concave lasso, workspace visibility, and sectioning for splats", () => {
    const points = new Float32Array([.2, .2, .5, .8, .8, .5, 1.5, .2, .5, .2, .2, 1.5]);
    const query = new PointSurfaceQuery(points);
    const lasso: SelectionVolume = { shape: "lasso", matrix: frame,
      outline: [[0, 0], [1, 0], [1, .35], [.35, .35], [.35, 1], [0, 1]], depth: 1 };
    expect(Array.from(query.selectVolume({ volume: lasso, parts: [state], section: null })[0]!)).toEqual([255, 0, 0, 0]);
    expect(Array.from(query.selectVolume({ volume: lasso, parts: [{ ...state, visible: new Uint8Array(4) }], section: null })[0]!))
      .toEqual([0, 0, 0, 0]);
    expect(Array.from(query.selectVolume({ volume: lasso, parts: [state], section: [0, 0, 1, -1] })[0]!))
      .toEqual([0, 0, 0, 0]);
  });

  it("intersects partial mesh faces through a lasso without selecting the cutout", () => {
    const lasso: SelectionVolume = { shape: "lasso", matrix: frame,
      outline: [[0, 0], [1, 0], [1, .35], [.35, .35], [.35, 1], [0, 1]], depth: 1 };
    const geometry = { positions: new Float32Array([
      -.4, .2, .5, .5, .2, .5, -.4, .8, .5,
      .65, .65, .5, .85, .65, .5, .65, .85, .5
    ]), indices: new Uint32Array([0, 1, 2, 3, 4, 5]) };
    const query = new MeshVisibilityQuery([geometry]);
    expect(Array.from(query.selectVolume({ volume: lasso, parts: [state], section: null })[0]!)).toEqual([255, 0]);
  });

  it("rejects a self crossing lasso instead of returning an arbitrary subset", () => {
    const query = new PointSurfaceQuery(new Float32Array([.5, .5, .5]));
    const volume: SelectionVolume = { shape: "lasso", matrix: frame,
      outline: [[0, 0], [1, 1], [0, 1], [1, 0]], depth: 1 };
    expect(() => query.selectVolume({ volume, parts: [state], section: null })).toThrow(/crosses itself/);
  });

  it("uses the same 3D brush stroke for splat centers and partially intersected mesh faces", () => {
    const volume: SelectionVolume = { shape: "brush", centers: [[0, 0, 0], [1, 0, 0]], radius: .2 };
    const splats = new PointSurfaceQuery(new Float32Array([0, 0, .1, .5, 0, .1, 1, 0, .1, .5, 0, .4]));
    expect(Array.from(splats.selectVolume({ volume, parts: [state], section: null })[0]!)).toEqual([255, 0, 255, 0]);
    const mesh = new MeshVisibilityQuery([{ positions: new Float32Array([
      .1, .1, 0, .4, .1, 0, .1, .4, 0,
      .4, .1, 0, .6, .1, 0, .4, .4, 0,
      .9, .1, 0, 1.2, .1, 0, .9, .4, 0
    ]), indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]) }]);
    expect(Array.from(mesh.selectVolume({ volume, parts: [state], section: null })[0]!)).toEqual([255, 0, 255]);
  });

  it("indexes a long brush stroke without changing point or face selection", () => {
    const volume: SelectionVolume = { shape: "brush",
      centers: Array.from({ length: 24 }, (_, i) => [i * .1, 0, 0] as [number, number, number]), radius: .12 };
    const splats = new PointSurfaceQuery(new Float32Array([1.1, .08, 0, 1.1, .25, 0]));
    expect(Array.from(splats.selectVolume({ volume, parts: [state], section: null })[0]!)).toEqual([255, 0]);
    const mesh = new MeshVisibilityQuery([{ positions: new Float32Array([
      1, .08, 0, 1.2, .08, 0, 1, .2, 0,
      1, .35, 0, 1.2, .35, 0, 1, .5, 0
    ]), indices: new Uint32Array([0, 1, 2, 3, 4, 5]) }]);
    expect(Array.from(mesh.selectVolume({ volume, parts: [state], section: null })[0]!)).toEqual([255, 0]);
  });
});
