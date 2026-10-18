import { expect, it } from "vitest";
import { BoundingBox, Entity, Mat4, Vec3 } from "playcanvas";
import { focusPosition } from "./focusSelection";

it("fits all bounds corners in portrait and landscape views from an oblique direction", () => {
  for (const aspectRatio of [.5, 2]) for (const horizontalFov of [false, true]) {
    const entity = new Entity(); entity.setPosition(8, 4, 10); entity.lookAt(Vec3.ZERO);
    const camera = { entity, aspectRatio, horizontalFov, fov: 45, nearClip: .01 };
    const bounds = new BoundingBox(new Vec3(20, 30, 40), new Vec3(1, 2, 3));
    const before = entity.getRotation().clone();
    entity.setPosition(focusPosition(bounds, camera));
    expect(entity.getRotation().equals(before)).toBe(true);
    const view = entity.getWorldTransform().clone().invert();
    const projection = new Mat4().setPerspective(camera.fov, aspectRatio, camera.nearClip, 1000, horizontalFov);
    const matrix = new Mat4().mul2(projection, view);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = bounds.center.clone().add(new Vec3(x, y * 2, z * 3));
      const projected = matrix.transformPoint(corner), data = matrix.data;
      const w = data[3]! * corner.x + data[7]! * corner.y + data[11]! * corner.z + data[15]!;
      expect(Math.abs(projected.x / w)).toBeLessThan(1);
      expect(Math.abs(projected.y / w)).toBeLessThan(1);
    }
    entity.destroy();
  }
});
