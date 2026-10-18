import { expect, it } from "vitest";
import { OrbitController, Quat, Vec3 } from "playcanvas";
import { copyFrame, framePose } from "./viewFrame";

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

it("saved reference poses do not share mutable vectors with edits", () => {
  const draft = { origin: new Vec3(1, 2, 3), rotation: new Quat(), distance: 5, fov: 45 };
  const saved = copyFrame(draft);
  draft.origin.set(8, 9, 10); draft.rotation.setFromEulerAngles(20, 30, 40);
  expect(saved.origin.equals(new Vec3(1, 2, 3))).toBe(true);
  expect(saved.rotation.equals(Quat.IDENTITY)).toBe(true);
});
