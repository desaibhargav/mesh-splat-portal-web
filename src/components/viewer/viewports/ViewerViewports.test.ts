import { expect, it } from "vitest";
import { EventHandler, Vec4, type AppBase, type CameraComponent, type Entity } from "playcanvas";
import { ViewerViewports, viewportContains, viewportPoint } from "./ViewerViewports";

it("routes canvas coordinates into exactly one panel with top-origin pointer coordinates", () => {
  const cameras = [new Vec4(0, .5, .5, .5), new Vec4(.5, .5, .5, .5), new Vec4(0, 0, .5, .5), new Vec4(.5, 0, .5, .5)]
    .map(rect => ({ rect }) as CameraComponent);
  for (const [index, [u, v]] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].entries()) {
    expect(cameras.map(camera => viewportContains(camera, u!, v!))).toEqual(cameras.map((_, i) => i === index));
    expect(viewportPoint(cameras[index]!, u!, v!)).toEqual({ u: .5, v: .5 });
  }
  expect(cameras.filter(camera => viewportContains(camera, .5, .5))).toHaveLength(1);
  expect(cameras.some(camera => viewportContains(camera, 1, 1))).toBe(false);
  expect(viewportPoint(cameras[0]!, .75, .75)).toEqual({ u: 1.5, v: 1.5 });
});


it("uses only the immersive camera during XR and restores the desktop panel arrangement afterward", async () => {
  function camera() {
    const controls = { enabled: false };
    return { entity: { script: { get: () => controls } }, layers: [0], rect: new Vec4(0, 0, 1, 1),
      scissorRect: new Vec4(0, 0, 1, 1), enabled: true } as unknown as CameraComponent;
  }
  const primary = camera(), xr = Object.assign(new EventHandler(), { active: false, camera: null as Entity | null });
  const app = Object.assign(new EventHandler(), { xr }) as unknown as AppBase;
  const rig = new ViewerViewports(app, primary);
  const other = { id: "right", label: "Right", camera: camera() }; rig.panels.push(other);
  rig.split = true; rig.activate(other);
  xr.camera = primary.entity; xr.active = true; xr.fire("start");
  expect(rig.split).toBe(false); expect(rig.active.camera).toBe(primary);
  expect(primary.enabled).toBe(true); expect(other.camera.enabled).toBe(false);
  rig.activate(other); expect(rig.active.camera).toBe(primary);
  // Native end listeners retain the camera until event processing completes.
  xr.fire("end"); xr.camera = null; xr.active = false;
  await Promise.resolve();
  expect(rig.split).toBe(true); expect(rig.active).toBe(other);
  expect(primary.enabled).toBe(true); expect(other.camera.enabled).toBe(true);
  expect(other.camera.rect.z).toBe(.5);
});
