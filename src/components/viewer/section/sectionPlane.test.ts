import { expect, it } from "vitest";
import { BoundingBox, GraphicsDevice, Mat4, NullGraphicsDevice, Quat, Vec3, type AppBase } from "playcanvas";
import { planeCoefficients, sectionFrame, sectionTest, setSectionPlane } from "./sectionPlane";

const reference = { origin: new Vec3(2, 3, 4), rotation: new Quat(), distance: 10, fov: 45 };
const bounds = new BoundingBox(new Vec3(8, -2, 6), new Vec3(2, 3, 4));

it("keeps flip complementary and places a tilted plane exactly through its origin", () => {
  const frame = sectionFrame(reference, bounds, { offset: .3, tiltX: 35, tiltY: -20, flip: false });
  const plane = planeCoefficients(frame, false), flipped = planeCoefficients(frame, true);
  plane.forEach((value, i) => expect(flipped[i]).toBeCloseTo(-value));
  const signed = (point: Vec3) => plane[0]! * point.x + plane[1]! * point.y + plane[2]! * point.z + plane[3]!;
  expect(signed(frame.origin)).toBeCloseTo(0, 5);
  const normal = frame.rotation.transformVector(Vec3.BACK);
  expect(signed(frame.origin.clone().add(normal))).toBeCloseTo(1, 5);
  expect(signed(frame.origin.clone().sub(normal))).toBeCloseTo(-1, 5);
});

it("offset limits sweep beyond every bounds corner for arbitrary references and tilts", () => {
  for (const offset of [-1, 1]) {
    const frame = sectionFrame(reference, bounds, { offset, tiltX: 35, tiltY: 70, flip: false });
    const plane = planeCoefficients(frame, false);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const point = bounds.center.clone().add(new Vec3(x * 2, y * 3, z * 4));
      const signed = plane[0]! * point.x + plane[1]! * point.y + plane[2]! * point.z + plane[3]!;
      expect(signed * offset).toBeLessThanOrEqual(1e-5);
    }
  }
});

it("X-ray classification uses the same world plane on transformed geometry", () => {
  const device: GraphicsDevice = new NullGraphicsDevice({} as HTMLCanvasElement);
  const app = { graphicsDevice: device } as AppBase;
  const transform = new Mat4().setTRS(new Vec3(1, 2, 3), new Quat().setFromEulerAngles(0, 0, 90), new Vec3(2, 3, 4));
  const positions = new Float32Array([0, 1, 0, 0, -1, 0]);
  setSectionPlane(app, new Float32Array([1, 0, 0, 0]));
  const test = sectionTest(app, positions, transform)!;
  expect(test(0)).toBe(false); expect(test(1)).toBe(true);
  setSectionPlane(app, null);
  expect(sectionTest(app, positions, transform)).toBeUndefined();
  device.destroy();
});
