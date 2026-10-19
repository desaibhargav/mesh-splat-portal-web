import { expect, it } from "vitest";
import { BoundingBox, Entity, Quat, Vec3 } from "playcanvas";
import { ViewerSpace } from "./ViewerSpace";

it("rotates both formats and their anchors about a stable pivot without changing source transforms or distances", () => {
  const parent = new Entity(), asset = new Entity(); parent.addChild(asset);
  asset.setLocalEulerAngles(0, 0, 180);
  const original = asset.getLocalTransform().clone();
  const pivot = new Vec3(3, -2, 5), space = new ViewerSpace(asset, pivot);
  const a = new Vec3(2, 1, 4), b = new Vec3(-3, 2, 8);
  for (const angles of [[0, 90, 0], [25, -40, 60], [0, 0, 0]]) {
    const rotation = new Quat().setFromEulerAngles(...angles as [number, number, number]);
    space.setRotation(rotation);
    expect(space.toWorld(pivot).equalsApprox(pivot)).toBe(true);
    expect(space.toLocal(space.toWorld(a)).equalsApprox(a)).toBe(true);
    expect(space.toWorld(a).distance(space.toWorld(b))).toBeCloseTo(a.distance(b), 5);
    expect(asset.getLocalTransform().equals(original)).toBe(true);
    expect(space.worldBounds(new BoundingBox(a, new Vec3(1, 2, 3))).center.equalsApprox(space.toWorld(a))).toBe(true);
  }
  space.destroy(); expect(asset.parent).toBe(parent); expect(asset.getLocalTransform().equals(original)).toBe(true);
  parent.destroy();
});
