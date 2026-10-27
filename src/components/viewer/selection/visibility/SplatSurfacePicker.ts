import { Vec3, type AppBase, type Entity } from "playcanvas";
import type { SurfaceHit } from "../types";
import type { SelectionVolume } from "../volume/SelectionVolume";

// One lazy point index in a worker, shared by mouse and XR surface tools.
// Transfer centers once and scope only after edits, never scan the cloud per frame.
export class SplatSurfacePicker {
  private readonly worker = new Worker(new URL("./visibility.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, { resolve(data: { hit?: { point: number[]; normal?: number[]; part: number; index: number } | null; result?: Uint8Array[] }): void; reject(error: Error): void }>();
  private serial = 0;
  private dirty = true;
  private failure: Error | null = null;
  constructor(private readonly app: AppBase, centers: Float32Array, private readonly entity: Entity) {
    const points = centers.slice(); this.worker.postMessage({ points }, [points.buffer]);
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id); this.pending.delete(data.id);
      if (data.error) {
        if (pending) pending.reject(new Error(data.error));
        else this.fail(new Error(data.error));
        return;
      }
      pending?.resolve(data);
    };
    this.worker.onerror = error => this.fail(new Error(error.message));
  }
  invalidate() { this.dirty = true; }
  pick(origin: Vec3, direction: Vec3, mask: Uint8Array, isolated: boolean, scope: Uint8Array | null, normal = false): Promise<SurfaceHit | null> {
    if (this.failure) return Promise.reject(this.failure);
    const enabled = this.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue();
    const plane = this.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue() as number[];
    const visible = this.dirty ? [isolated || scope ? Uint8Array.from(mask, (value, i) => Number((!isolated || !!value) && (!scope || !!scope[i]))) : null] : undefined;
    this.dirty = false;
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: data => resolve(data.hit ? { ...data.hit, point: new Vec3(...data.hit.point as [number, number, number]),
        normal: data.hit.normal ? new Vec3(...data.hit.normal as [number, number, number]) : undefined } : null), reject });
      this.worker.postMessage({ id, ray: { origin: origin.toArray(), direction: direction.toArray(), section: enabled ? Array.from(plane) : null,
        parts: [{ model: Array.from(this.entity.getWorldTransform().data), side: 2 }], normal }, visible });
    });
  }
  selectVolume(volume: SelectionVolume, mask: Uint8Array, isolated: boolean, scope: Uint8Array | null): Promise<Uint8Array[]> {
    if (this.failure) return Promise.reject(this.failure);
    const enabled = !!this.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue();
    const plane = this.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue() as number[];
    const visible = isolated || scope ? Uint8Array.from(mask, (selected, i) =>
      Number((!isolated || !!selected) && (!scope || !!scope[i]))) : null;
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: data => resolve(data.result!), reject });
      this.worker.postMessage({ id, volume: { volume, parts: [{ model: Array.from(this.entity.getWorldTransform().data),
        side: 2, visible }], section: enabled ? Array.from(plane) : null } });
    });
  }
  private fail(error: Error) { this.failure = error; for (const p of this.pending.values()) p.reject(error); this.pending.clear(); this.worker.terminate(); }
  destroy() { this.fail(new Error("Viewer closed during surface picking.")); }
}
