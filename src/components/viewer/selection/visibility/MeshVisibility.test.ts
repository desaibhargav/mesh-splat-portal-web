import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBase } from "playcanvas";
import { MeshVisibility } from "./MeshVisibility";

class WorkerStub {
  static current: WorkerStub;
  onmessage?: (event: { data: { id: number; result?: Uint8Array[]; error?: string } }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { WorkerStub.current = this; }
}
function controller() {
  vi.stubGlobal("Worker", WorkerStub);
  return new MeshVisibility({} as AppBase, []);
}
const snapshot = () => ({ projection: [], view: [], parts: [], section: null, width: 1, height: 1, alpha: new Uint8Array([255]) });
afterEach(() => vi.unstubAllGlobals());

describe("visibility worker ownership", () => {
  it("resolves the matching request without changing subsequent requests", async () => {
    const visibility = controller(), first = visibility.complete(snapshot(), null), second = visibility.complete(snapshot(), null);
    WorkerStub.current.onmessage!({ data: { id: 2, result: [new Uint8Array([255])] } });
    expect((await second)[0]![0]).toBe(255);
    WorkerStub.current.onmessage!({ data: { id: 1, result: [new Uint8Array([0])] } });
    expect((await first)[0]![0]).toBe(0);
    visibility.destroy();
  });
  it("terminates once and rejects pending requests on viewer teardown", async () => {
    const visibility = controller(), pending = visibility.complete(snapshot(), null);
    visibility.destroy(); visibility.destroy();
    await expect(pending).rejects.toThrow("Viewer closed");
    await expect(visibility.complete(snapshot(), null)).rejects.toThrow("Viewer closed");
    expect(WorkerStub.current.terminate).toHaveBeenCalledTimes(1);
  });
  it("retains initialization failure so a later GPU readback cannot leave a query hanging", async () => {
    const visibility = controller();
    WorkerStub.current.onmessage!({ data: { id: 0, error: "Initialization failed" } });
    await expect(visibility.complete(snapshot(), null)).rejects.toThrow("Initialization failed");
    visibility.destroy();
  });
});
