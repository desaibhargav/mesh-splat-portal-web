import { expect, it } from "vitest";
import { OrbitController, Quat, Vec3 } from "playcanvas";
import { axisFrame, copyFrame, framePose, threePointFrame } from "./viewFrame";

it("recalls a translated, rolled reference with its orbit pivot intact", () => {
  const frame = { origin: new Vec3(12, -8, 3), rotation: new Quat().setFromEulerAngles(25, 40, 65), distance: 7, fov: 35 };
  const pose = framePose(frame);
  expect(pose.getFocus(new Vec3()).equalsApprox(frame.origin)).toBe(true);
  expect(new Quat().setFromEulerAngles(pose.angles).equalsApprox(frame.rotation)).toBe(true);
  expect(pose.position.distance(frame.origin)).toBeCloseTo(frame.distance);

  // Exercise the actual engine controller: a restored pose must retain roll
  // and orbit about its reference, not jump on the next navigation update.
  const orbit = new OrbitController();
  orbit.attach(pose, false);
  const input = { read: () => ({ move: [0, 0, 0], rotate: [0, 0, 0] }) };
  const restored = orbit.update(input as Parameters<OrbitController["update"]>[0], 1 / 60);
  expect(restored.equalsApprox(pose)).toBe(true);
  orbit.destroy();
});

it("aligns each axis without moving the origin or changing the framing", () => {
  const original = { origin: new Vec3(4, 5, 6), rotation: new Quat(), distance: 8, fov: 40 };
  for (const [axis, normal] of [["X", Vec3.RIGHT], ["Y", Vec3.UP], ["Z", Vec3.BACK]] as const) {
    const frame = axisFrame(original, axis);
    expect(frame.rotation.transformVector(Vec3.BACK).equalsApprox(normal)).toBe(true);
    expect(frame.origin.equals(original.origin)).toBe(true);
    expect(frame.distance).toBe(original.distance);
  }
});

it("defines a three-point plane and X direction independently of scan scale", () => {
  const reference = { origin: new Vec3(), rotation: new Quat(), distance: 5, fov: 45 };
  for (const scale of [1e-6, 1, 1e6]) {
    const points: [Vec3, Vec3, Vec3] = [new Vec3(1, 2, 3), new Vec3(2, 3, 4), new Vec3(1, 3, 3)]
      .map(point => point.mulScalar(scale)) as [Vec3, Vec3, Vec3];
    const frame = threePointFrame(reference, points);
    const normal = frame.rotation.transformVector(Vec3.BACK), x = frame.rotation.transformVector(Vec3.RIGHT);
    expect(frame.origin.equals(points[0])).toBe(true);
    expect(x.equalsApprox(points[1].clone().sub(points[0]).normalize())).toBe(true);
    expect(Math.abs(normal.dot(points[1].clone().sub(points[0])) / scale)).toBeLessThan(1e-6);
    expect(Math.abs(normal.dot(points[2].clone().sub(points[0])) / scale)).toBeLessThan(1e-6);
  }
  expect(() => threePointFrame(reference, [Vec3.ZERO, Vec3.RIGHT, new Vec3(2, 0, 0)])).toThrow("non-collinear");
  expect(() => threePointFrame(reference, [Vec3.ZERO, Vec3.ZERO, Vec3.UP])).toThrow("distinct");
});

it("keeps a three-point view facing the user for either click winding", () => {
  const reference = { origin: new Vec3(), rotation: new Quat(), distance: 5, fov: 45 };
  for (const third of [Vec3.UP, Vec3.DOWN]) {
    const frame = threePointFrame(reference, [Vec3.ZERO, Vec3.RIGHT, third]);
    expect(frame.rotation.transformVector(Vec3.BACK).equalsApprox(Vec3.BACK)).toBe(true);
    expect(frame.rotation.transformVector(Vec3.RIGHT).equalsApprox(Vec3.RIGHT)).toBe(true);
  }
});

it("saved reference poses do not share mutable vectors with edits", () => {
  const draft = { origin: new Vec3(1, 2, 3), rotation: new Quat(), distance: 5, fov: 45 };
  const saved = copyFrame(draft);
  draft.origin.set(8, 9, 10); draft.rotation.setFromEulerAngles(20, 30, 40);
  expect(saved.origin.equals(new Vec3(1, 2, 3))).toBe(true);
  expect(saved.rotation.equals(Quat.IDENTITY)).toBe(true);
});
