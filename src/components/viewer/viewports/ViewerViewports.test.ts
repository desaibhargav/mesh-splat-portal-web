import { expect, it } from "vitest";
import { EventHandler, PROJECTION_ORTHOGRAPHIC, PROJECTION_PERSPECTIVE, Quat, Vec3, Vec4, type AppBase, type CameraComponent, type Entity } from "playcanvas";
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

it("recalls perspective framing in orthographic panels without using its dormant orthographic height", () => {
  const makeCamera = (projection: number) => {
    const controls = { focusPoint: new Vec3(), restorePose: () => {}, enabled: true };
    return { projection, orthoHeight: 10, fov: 45, enabled: true, layers: [0],
      entity: { script: { get: () => controls }, getPosition: () => new Vec3(0,0,2), getRotation: () => new Quat() }
    } as unknown as CameraComponent;
  };
  const app = new EventHandler() as AppBase, perspective = makeCamera(PROJECTION_PERSPECTIVE);
  const rig = new ViewerViewports(app, perspective), top = makeCamera(PROJECTION_ORTHOGRAPHIC);
  rig.panels.push({id:"top",label:"Top",camera:top}); rig.split = true;
  rig.restore({origin:new Vec3(),rotation:new Quat(),distance:2,fov:45,projection:PROJECTION_PERSPECTIVE,orthoHeight:10});
  expect(top.projection).toBe(PROJECTION_ORTHOGRAPHIC);
  expect(top.orthoHeight).toBeCloseTo(2*Math.tan(Math.PI/8));
  rig.restore({origin:new Vec3(),rotation:new Quat(),distance:2,fov:45,projection:PROJECTION_ORTHOGRAPHIC,orthoHeight:.3});
  expect(top.orthoHeight).toBe(.3);
});
