import { expect, it } from "vitest";
import { ASPECT_MANUAL, BoundingBox, Camera, GraphNode, PROJECTION_ORTHOGRAPHIC, Vec3, Vec4, type CameraComponent, type GraphicsDevice } from "playcanvas";
import { brushDiameter } from "./brushDiameter";

function camera(distance: number, orthographic = false, split = false) {
  const entity = new GraphNode(); entity.setPosition(0, 0, distance);
  const native = new Camera({} as GraphicsDevice);
  native.node = entity; native.aspectRatioMode = ASPECT_MANUAL; native.aspectRatio = 1; native.orthoHeight = 2;
  if (orthographic) native.projection = PROJECTION_ORTHOGRAPHIC;
  if (split) native.rect = new Vec4(.5, .5, .5, .5);
  return { entity, projection: native.projection, nearClip: native.nearClip,
    worldToScreen: (point: Vec3, result: Vec3) => native.worldToScreen(point, 800, 800, result)
  } as CameraComponent;
}
const bounds = new BoundingBox(Vec3.ZERO, new Vec3(1, 1, 0));
it("uses half the projected asset span at 50 percent and scales with zoom and viewport size", () => {
  expect(brushDiameter(bounds, camera(5, true), 50)).toBeCloseTo(200);
  expect(brushDiameter(bounds, camera(5, true, true), 50)).toBeCloseTo(100);
  expect(brushDiameter(bounds, camera(5), 50)).toBeCloseTo(brushDiameter(bounds, camera(10), 50) * 2);
  expect(brushDiameter(bounds, camera(5), 10)).toBeCloseTo(brushDiameter(bounds, camera(5), 50) / 5);
});
it("keeps the brush finite when the camera enters the active bounds", () => {
  const size = brushDiameter(new BoundingBox(Vec3.ZERO, Vec3.ONE), camera(.5), 50);
  expect(Number.isFinite(size)).toBe(true);
  expect(size).toBeGreaterThan(0);
});
