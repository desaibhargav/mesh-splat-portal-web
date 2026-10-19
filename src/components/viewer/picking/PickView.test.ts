import { expect, it } from "vitest";
import { ASPECT_AUTO, ASPECT_MANUAL, Vec4, type CameraComponent } from "playcanvas";
import { renderPickView } from "./PickView";

it("preserves camera identity and restores the panel after a failed native pick pass", () => {
  const camera = { rect: new Vec4(.5, .5, .5, .5), scissorRect: new Vec4(.5, .5, .5, .5),
    aspectRatioMode: ASPECT_AUTO, aspectRatio: 2 } as CameraComponent;
  expect(() => renderPickView(camera, () => {
    expect(camera.rect.toArray()).toEqual([0, 0, 1, 1]);
    expect(camera.aspectRatioMode).toBe(ASPECT_MANUAL);
    throw new Error("Pick cancelled");
  })).toThrow("Pick cancelled");
  expect(camera.rect.toArray()).toEqual([.5, .5, .5, .5]);
  expect(camera.scissorRect.toArray()).toEqual([.5, .5, .5, .5]);
  expect(camera.aspectRatioMode).toBe(ASPECT_AUTO);
  expect(camera.aspectRatio).toBe(2);
});
