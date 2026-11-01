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

it("keeps a saved orientation local under translated, rotated and scaled XR presentation", () => {
  const parent=new Entity(),asset=new Entity();parent.addChild(asset);
  const pivot=new Vec3(3,-2,5),space=new ViewerSpace(asset,pivot),presentation=new Entity();
  parent.addChild(presentation);presentation.addChild(space.root);
  presentation.setPosition(2,1,-4);presentation.setEulerAngles(20,-35,15);presentation.setLocalScale(2,2,2);
  const expected=presentation.getWorldTransform().transformPoint(pivot);
  const rotation=new Quat().setFromEulerAngles(-10,40,25);
  space.setRotation(rotation);
  expect(space.rotation.equalsApprox(rotation)).toBe(true);
  expect(space.toWorld(pivot).equalsApprox(expected,1e-5)).toBe(true);
  const point=new Vec3(1,2,3);
  expect(space.toLocal(space.toWorld(point)).equalsApprox(point,1e-5)).toBe(true);
  space.destroy();parent.destroy();
});
