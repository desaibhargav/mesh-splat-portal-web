import { expect, it } from "vitest";
import { BoundingBox, Entity, EventHandler, Quat, Vec3, Vec4 } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { ImmersiveScene } from "./ImmersiveScene";

it("normalizes presentation without changing saved coordinates and carries the retained section half-space through manipulation", () => {
  const app = Object.assign(new EventHandler(), { root: new Entity(), graphicsDevice: { scope: {
    resolve: (name: string) => ({ getValue: () => values.get(name), setValue: (value: unknown) => values.set(name, value) })
  } } });
  const values = new Map<string, unknown>([["portalSectionEnabled", 1], ["portalSectionPlane", new Float32Array([0, 1, 0, -2])]]);
  const root = new Entity(), camera = new Entity(); app.root.addChild(root);
  root.setLocalPosition(3, 2, -5); root.setLocalRotation(new Quat().setFromEulerAngles(10, 20, 30));
  const original = root.getWorldTransform().clone(), handle = { app, space: { root } } as unknown as SelectionHandle;
  const bounds = new BoundingBox(new Vec3(3, 2, -5), new Vec3(2, 4, 1));
  const scene = new ImmersiveScene(handle, bounds);
  camera.setLocalPosition(1, 1.6, -1); camera.setLocalEulerAngles(0, 45, 0);
  scene.place(camera);
  const centre = scene.root.getWorldTransform().transformPoint(bounds.center);
  const ahead = camera.forward.clone().mulScalar(1.5).add(camera.getPosition());
  expect(centre.equalsApprox(ahead, 1e-5)).toBe(true);
  expect(scene.root.getLocalScale().x * bounds.halfExtents.y * 2).toBeCloseTo(1);
  expect(root.getLocalTransform().equals(original)).toBe(true);
  const floor = new Vec3(.4, .05, -.7);
  scene.placeOnFloor(floor, camera);
  const bottom = bounds.center.clone(); bottom.y -= bounds.halfExtents.y;
  expect(scene.root.getWorldTransform().transformPoint(bottom).equalsApprox(floor, 1e-5)).toBe(true);
  const size = scene.root.getLocalScale().x;
  scene.zoom(2);
  expect(scene.root.getLocalScale().x).toBeCloseTo(size * 2);
  expect(scene.root.getWorldTransform().transformPoint(bottom).equalsApprox(floor, 1e-5)).toBe(true);
  scene.zoom(8);
  expect(scene.root.getLocalScale().x).toBeCloseTo(size * 16);
  expect(scene.root.getWorldTransform().transformPoint(bottom).equalsApprox(floor, 1e-5)).toBe(true);
  const zoomed = scene.root.getLocalTransform().clone();
  for (const invalid of [0, -1, Infinity, NaN]) scene.zoom(invalid);
  expect(scene.root.getLocalTransform().equals(zoomed)).toBe(true);
  scene.reset();
  expect(scene.root.getLocalScale().x).toBeCloseTo(size);
  for (const angles of [[0, 0, 0], [10, 35, 25], [75, -20, 5]]) {
    scene.root.setPosition(1, 3, -2); scene.root.setEulerAngles(...angles as [number, number, number]); scene.root.setLocalScale(.5, .5, .5);
    app.fire("prerender");
    const plane = values.get("portalSectionPlane") as Float32Array;
    for (const [point, retained] of [[new Vec3(1, 3, -1), true], [new Vec3(1, 1, -1), false]] as const) {
      const world = scene.root.getWorldTransform().transformPoint(point);
      expect(new Vec4(plane[0]!, plane[1]!, plane[2]!, plane[3]!).dot(new Vec4(world.x, world.y, world.z, 1)) >= 0).toBe(retained);
    }
  }
  scene.destroy();
  expect(root.parent).toBe(app.root); expect(root.getWorldTransform().equals(original)).toBe(true);
  expect(Array.from(values.get("portalSectionPlane") as Float32Array)).toEqual([0, 1, 0, -2]);
  app.root.destroy(); camera.destroy();
});
