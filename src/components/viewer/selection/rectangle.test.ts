import { describe, expect, it } from "vitest";
import { Mat4, Quat, Vec3 } from "playcanvas";
import { rectangleBetween, selectCenters, selectionOperation } from "./rectangle";

const rectangle = rectangleBetween({ x: 0.5, y: 0 }, { x: 1, y: 1 });
const centers = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0.8]);

describe("rectangle selection", () => {
  it("normalizes drag direction and preserves through-depth selection", () => {
    expect(rectangleBetween({ x: 1, y: 1 }, { x: 0.5, y: 0 })).toEqual(rectangle);
    const mask = new Uint8Array(3);
    expect(selectCenters(centers, mask, Mat4.IDENTITY.data, rectangle, "set", false)).toBe(2);
    expect([...mask]).toEqual([0, 255, 255]);
  });

  it("applies the actual entity rotation before testing the rectangle", () => {
    const transform = new Mat4().setTRS(Vec3.ZERO, new Quat().setFromEulerAngles(0, 0, 180), Vec3.ONE);
    const mask = new Uint8Array(3);
    expect(selectCenters(centers, mask, transform.data, rectangle, "set", false)).toBe(1);
    expect([...mask]).toEqual([255, 0, 0]);
  });

  it("excludes centers behind the camera and beyond clipping planes", () => {
    const matrix = new Mat4().setPerspective(45, 1, 0.1, 10);
    const points = new Float32Array([0.1, 0, -1, 0.1, 0, 1, 0.1, 0, -20, 0.01, 0, -0.01]);
    const mask = new Uint8Array(4);
    expect(selectCenters(points, mask, matrix.data, rectangle, "set", false)).toBe(1);
    expect([...mask]).toEqual([255, 0, 0, 0]);
  });

  it("supports add, remove, and intersection without changing original IDs", () => {
    const mask = new Uint8Array([255, 0, 0]);
    expect(selectCenters(centers, mask, Mat4.IDENTITY.data, rectangle, "add", false)).toBe(3);
    expect(selectCenters(centers, mask, Mat4.IDENTITY.data, rectangle, "intersect", false)).toBe(2);
    expect([...mask]).toEqual([0, 255, 255]);
    expect(selectCenters(centers, mask, Mat4.IDENTITY.data, rectangle, "remove", false)).toBe(0);
  });

  it("does not select hidden centers while isolated", () => {
    const mask = new Uint8Array([0, 255, 0]);
    expect(selectCenters(centers, mask, Mat4.IDENTITY.data, rectangle, "add", true)).toBe(1);
    expect([...mask]).toEqual([0, 255, 0]);
  });

  it("clears an old selection when a replacement rectangle contains no centers", () => {
    const mask = new Uint8Array([255, 255, 255]);
    const empty = rectangleBetween({ x: 0.9, y: 0 }, { x: 1, y: 0.1 });
    expect(selectCenters(centers, mask, Mat4.IDENTITY.data, empty, "set", false)).toBe(0);
    expect([...mask]).toEqual([0, 0, 0]);
  });

  it("maps Ctrl and Cmd consistently, including intersection", () => {
    expect(selectionOperation({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe("set");
    expect(selectionOperation({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe("add");
    expect(selectionOperation({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe("remove");
    expect(selectionOperation({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe("remove");
    expect(selectionOperation({ shiftKey: true, ctrlKey: false, metaKey: true })).toBe("intersect");
  });
});
