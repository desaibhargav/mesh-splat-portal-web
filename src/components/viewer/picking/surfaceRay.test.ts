import { expect, it } from "vitest";
import { Entity, Vec3 } from "playcanvas";
import { ViewerSpace } from "../ViewerSpace";
import type { SelectionHandle } from "../selection/types";
import { pickSurfaceRay } from "./surfaceRay";

it("keeps an asynchronous hit in source coordinates when presentation moves during the query", async () => {
  const root = new Entity(), asset = new Entity(); root.addChild(asset);
  const space = new ViewerSpace(asset, Vec3.ZERO), local = new Vec3(.2, -.3, .1);
  space.root.setPosition(1, 2, -3); space.root.setEulerAngles(20, 40, 15); space.root.setLocalScale(.3, .3, .3);
  const hit = space.toWorld(local);
  let complete!: (point: Vec3) => void;
  const handle = { space, selection: { pickRay: () => new Promise<Vec3>(resolve => { complete = resolve; }) } } as unknown as SelectionHandle;
  const pending = pickSurfaceRay(handle, new Vec3(), Vec3.FORWARD);
  space.root.setPosition(3, -1, 2); space.root.setLocalScale(2, 2, 2); space.root.setEulerAngles(-30, 10, 60);
  complete(hit);
  expect((await pending)!.equalsApprox(local, 1e-6)).toBe(true);
  space.destroy(); root.destroy();
});
