import { expect, it } from "vitest";
import { ScriptRegistry, type AppBase } from "playcanvas";
import { CameraControls } from "./CameraControls";

it("registers the camera under a stable name even when its class name is minified", () => {
  const name = Object.getOwnPropertyDescriptor(CameraControls, "name")!;
  const registry = new ScriptRegistry({} as AppBase);
  try {
    Object.defineProperty(CameraControls, "name", { value: "a", configurable: true });
    registry.add(CameraControls);
    expect(registry.get("cameraControls")).toBe(CameraControls);
    expect(registry.get("a")).toBeNull();
  } finally {
    Object.defineProperty(CameraControls, "name", name);
    registry.destroy();
  }
});
