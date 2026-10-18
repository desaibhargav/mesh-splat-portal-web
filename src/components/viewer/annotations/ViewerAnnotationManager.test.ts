import { afterEach, expect, it, vi } from "vitest";
import { Entity, Mesh, MeshInstance, NullGraphicsDevice, StandardMaterial, type AppBase } from "playcanvas";
import { AnnotationManager } from "playcanvas/scripts/esm/annotations.mjs";
import { ViewerAnnotationManager } from "./ViewerAnnotationManager";

afterEach(() => vi.restoreAllMocks());

it("keeps the shared marker mesh alive when replacing the last draft with a saved marker", () => {
  const device = new NullGraphicsDevice({ width: 1, height: 1 } as HTMLCanvasElement);
  const mesh = new Mesh(device), material = new StandardMaterial();
  mesh.setPositions([0, 0, 0, 1, 0, 0, 0, 1, 0]); mesh.update();
  const vertices = mesh.vertexBuffer;
  // Bypass DOM/layer initialization only; exercise real engine mesh ownership.
  vi.spyOn(AnnotationManager.prototype, "initialize").mockImplementation(function (this: AnnotationManager) {
    Object.assign(this, { _mesh: mesh });
    this.once("destroy", () => mesh.destroy());
  });
  const entity = { enabled: true, script: { enabled: true } } as unknown as Entity;
  const manager = new ViewerAnnotationManager({ app: {} as AppBase, entity });
  manager.initialize();
  for (let replacement = 0; replacement < 3; replacement++) {
    const base = new MeshInstance(mesh, material), overlay = new MeshInstance(mesh, material);
    base.destroy(); overlay.destroy();
    expect(mesh.vertexBuffer).toBe(vertices);
    expect(mesh.refCount).toBe(1);
  }
  manager.fire("destroy");
  expect(mesh.vertexBuffer).toBeNull();
  expect(mesh.refCount).toBe(0);
  material.destroy(); device.destroy();
});
