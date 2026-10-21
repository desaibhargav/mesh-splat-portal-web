import { CULLFACE_BACK, CULLFACE_FRONT, type AppBase, type CameraComponent, type MeshInstance } from "playcanvas";
import type { SelectionRegion } from "../types";
import type { VisibilityGeometry, VisibilityPart, VisibilityQuery } from "./visibilityTypes";
import { regionAlpha, type PickImage } from "../pickImage";

interface Part { source: MeshInstance; positions: Float32Array; indices: number[]; mask: Uint8Array; scope: Uint8Array | null }

// One lazily-created worker per mesh controller. Geometry is copied/transferred
// once, never on animation frames; visibility and camera snapshots belong to
// each committed gesture. Closing the viewer terminates its queries and memory.
export class MeshVisibility {
  private readonly worker = new Worker(new URL("./visibility.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, { resolve(value: Uint8Array[]): void; reject(error: Error): void }>();
  private serial = 0;
  private disposed = false;
  private failure?: Error;
  constructor(private readonly app: AppBase, private readonly parts: Part[]) {
    const geometry: VisibilityGeometry[] = parts.map(part => ({ positions: part.positions.slice(), indices: Uint32Array.from(part.indices) }));
    this.worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: Uint8Array[]; error?: string }>) => {
      if (data.id === 0 && data.error) { this.fail(new Error(data.error)); return; }
      const pending = this.pending.get(data.id); this.pending.delete(data.id);
      if (data.result) pending?.resolve(data.result); else pending?.reject(new Error(data.error));
    };
    this.worker.onerror = event => this.fail(new Error(event.message || "Mesh visibility worker failed."));
    this.worker.postMessage({ id: 0, geometry }, geometry.flatMap(part => [part.positions.buffer, part.indices.buffer]));
  }

  snapshot(camera: CameraComponent, region: SelectionRegion, isolated: boolean): Omit<VisibilityQuery, "hits"> {
    const enabled = !!this.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue();
    const plane = this.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue() as ArrayLike<number> | undefined;
    const alpha = regionAlpha(region);
    const parts: VisibilityPart[] = this.parts.map(part => {
      let visible: Uint8Array | null = null;
      if (isolated || part.scope) visible = Uint8Array.from(part.mask, (selected, face) => Number((!isolated || !!selected) && (!part.scope || !!part.scope[face])));
      const cull = part.source.material.cull;
      return { model: Array.from(part.source.node.getWorldTransform().data), side: enabled ? 2 : cull === CULLFACE_BACK ? 0 : cull === CULLFACE_FRONT ? 1 : 2, visible };
    });
    return { projection: Array.from(camera.projectionMatrix.data), view: Array.from(camera.viewMatrix.data), width: region.width, height: region.height,
      alpha, parts, section: enabled && plane ? Array.from(plane) : null };
  }

  complete(snapshot: Omit<VisibilityQuery, "hits">, image: PickImage | null): Promise<Uint8Array[]> {
    if (this.disposed) return Promise.reject(new Error("Viewer closed during selection."));
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, query: snapshot, image }, [snapshot.alpha.buffer, ...(image ? [image.pixels.buffer] : [])]);
    });
  }

  private fail(error: Error) { this.failure = error; this.worker.terminate(); for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.fail(new Error("Viewer closed during selection."));
  }
}
