import { expect, it, vi } from "vitest";
import { ASPECT_AUTO, ASPECT_MANUAL, Vec4, type CameraComponent } from "playcanvas";
import { renderPickView } from "./PickView";

it.each([true, false])("restores camera state and temporary layer membership after a failed native pass (registered=%s)", registered => {
  const members: unknown[] = [];
  const layer = { cameras: members, addCamera: vi.fn((camera: unknown) => members.push(camera)),
    removeCamera: vi.fn((camera: unknown) => members.splice(members.indexOf(camera), 1)) };
  const camera = { enabled: registered, layers: [1], rect: new Vec4(.5, .5, .5, .5), scissorRect: new Vec4(.5, .5, .5, .5),
    aspectRatioMode: ASPECT_AUTO, aspectRatio: 2, onAppPrerender: vi.fn(),
    system: { app: { scene: { layers: { getLayerById: () => layer } } } } } as unknown as CameraComponent;
  if (registered) members.push(camera);
  expect(() => renderPickView(camera, () => {
    expect(members).toEqual([camera]);
    expect(camera.enabled).toBe(registered); // A query must never enable an extra scene camera.
    expect(camera.rect.toArray()).toEqual([0, 0, 1, 1]);
    expect(camera.aspectRatioMode).toBe(ASPECT_MANUAL);
    throw new Error("Pick cancelled");
  })).toThrow("Pick cancelled");
  expect(members).toEqual(registered ? [camera] : []);
  expect(camera.rect.toArray()).toEqual([.5, .5, .5, .5]);
  expect(camera.scissorRect.toArray()).toEqual([.5, .5, .5, .5]);
  expect(camera.aspectRatioMode).toBe(ASPECT_AUTO);
  expect(camera.aspectRatio).toBe(2);
});
