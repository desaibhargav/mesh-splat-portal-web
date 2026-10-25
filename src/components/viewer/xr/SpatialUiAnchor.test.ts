import { expect, it } from "vitest";
import { Entity, EventHandler, type AppBase } from "playcanvas";
import { SpatialUiAnchor } from "./SpatialUiAnchor";

it("keeps panels level and stationary in the dead zone, follows larger turns, and freezes during interaction", () => {
  const app = Object.assign(new EventHandler(), { root: new Entity(), xr: Object.assign(new EventHandler(), { active: true }) });
  const camera = new Entity(); app.root.addChild(camera); camera.setPosition(5, 10, 20);
  let interacting = false;
  const ui = new SpatialUiAnchor(app as unknown as AppBase, camera, () => interacting);
  app.fire("update", 1 / 90); // Session start, before any tracked headset pose.
  camera.setPosition(0, 1.6, 0);
  app.xr.fire("update");
  app.fire("update", 1 / 90);
  const position = ui.root.getPosition().clone(), rotation = ui.root.getRotation().clone();
  camera.setEulerAngles(65, 20, 0); camera.setPosition(.05, 1.8, .04);
  for (let i = 0; i < 90; i++) app.fire("update", 1 / 90);
  expect(ui.root.getPosition().equals(position)).toBe(true); expect(ui.root.getRotation().equals(rotation)).toBe(true);
  interacting = true; camera.setEulerAngles(30, 90, 0);
  for (let i = 0; i < 90; i++) app.fire("update", 1 / 90);
  expect(ui.root.getRotation().equals(rotation)).toBe(true);
  interacting = false;
  for (let i = 0; i < 180; i++) app.fire("update", 1 / 90);
  expect(ui.root.forward.dot(camera.forward)).toBeGreaterThan(.85);
  expect(ui.root.up.y).toBeCloseTo(1); expect(ui.root.getPosition().y).toBeCloseTo(1.6);
  ui.destroy(); app.root.destroy();
});
