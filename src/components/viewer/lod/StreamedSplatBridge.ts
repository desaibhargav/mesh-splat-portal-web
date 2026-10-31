import { GSPLAT_STREAM_RESOURCE, PIXELFORMAT_RG32U, type AppBase, type Asset, type GSplatComponent,
  type CameraComponent, type GSplatResourceBase } from "playcanvas";
import type { LodData, LodMapping } from "./LodData";

interface Chunk { file: number; level: number; offset: number; count: number; base: number; url: string }

// Uses native resource/work-buffer streams. The engine still owns spatial LOD,
// loading, sorting and draw submission; IDs only connect its chunks to edit data.
export class StreamedSplatBridge {
  private readonly chunks: Chunk[];
  private readonly prepared = new WeakSet<GSplatResourceBase>();
  private disposed = false;
  private enabled = false;
  private readonly pending = new Set<() => void>();
  private constructor(private readonly app: AppBase, readonly data: LodData, readonly mappings: readonly LodMapping[],
    private readonly onError: (error: Error) => void) {
    let base = 0;
    this.chunks = data.descriptor.editing.chunks.map(chunk => {
      const result = { ...chunk, base, url: "" }; base += chunk.count; return result;
    });
    if (base >= 0xffffffff) throw new Error("Streamed picking exceeds the supported ID range.");

  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.app.scene.gsplat.format.addExtraStreams([{ name: "portalIds", format: PIXELFORMAT_RG32U }]);
    this.app.assets.on("load", this.loaded, this);
    for (const asset of this.app.assets.list()) this.loaded(asset);
  }

  static create(component: GSplatComponent, data: LodData, onError: (error: Error) => void) {
    const mappings = data.descriptor.levels.map(level => data.readyMapping(level.level));
    const resource = component.resource as unknown as { octree: { files: { url: string }[] } };
    if (!resource.octree) throw new Error("Expected a native streamed splat resource.");
    const urls = data.descriptor.editing.chunks.map(chunk => {
      const file = resource.octree.files[chunk.file];
      if (!file) throw new Error("Correspondence references an unknown streamed file.");
      return new URL(file.url, data.url).href;
    });
    const bridge = new StreamedSplatBridge(component.system.app, data, mappings, onError);
    bridge.chunks.forEach((chunk, index) => { chunk.url = urls[index]!; });
    return bridge;
  }

  ready(camera: CameraComponent): Promise<void> {
    return new Promise((resolve, reject) => {
      const system = this.app.systems.gsplat!;
      const cancel = () => { cleanup(); reject(new Error("Viewer closed during splat preparation.")); };
      const finish = () => { cleanup(); resolve(); };
      const cleanup = () => { system.off("frame:ready", ready); this.app.off("postrender", finish); this.app.off("destroy", cancel); this.pending.delete(cancel); };
      const ready = (view: CameraComponent, _layer: unknown, complete: boolean, loading: number) => {
        if (view === camera && complete && !loading) this.app.once("postrender", finish);
      };
      this.pending.add(cancel);
      system.on("frame:ready", ready); this.app.once("destroy", cancel);
      this.app.renderNextFrame = true;
    });
  }

  private loaded(asset: Asset) {
    if (this.disposed) return;
    try { this.prepare(asset); }
    catch (error) { this.onError(error instanceof Error ? error : new Error(String(error))); }
  }
  private prepare(asset: Asset) {
    const url = asset.getFileUrl();
    if (asset.type !== "gsplat" || !asset.resource || !url) return;
    const chunk = this.chunks.find(chunk => chunk.url === new URL(url, this.data.url).href);
    if (!chunk) return;
    const resource = asset.resource as GSplatResourceBase;
    if (this.prepared.has(resource)) return;
    if (resource.numSplats !== chunk.count) throw new Error("Streamed chunk count differs from correspondence metadata.");
    resource.format.addExtraStreams([{ name: "portalIdsSource", format: PIXELFORMAT_RG32U, storage: GSPLAT_STREAM_RESOURCE }]);
    resource.streams.syncWithFormat(resource.format);
    const ids = resource.getTexture("portalIdsSource")!, pixels = ids.lock() as Uint32Array;
    const canonical = this.mappings[chunk.level]!.from;
    for (let index = 0; index < chunk.count; index++) {
      pixels[index * 2] = canonical[chunk.offset + index]!;
      pixels[index * 2 + 1] = chunk.base + index;
    }
    ids.unlock(); this.prepared.add(resource);
  }

  canonicalId(id: number): number | null {
    const chunk = this.chunks.find(chunk => id >= chunk.base && id < chunk.base + chunk.count);
    return chunk ? this.mappings[chunk.level]!.from[chunk.offset + id - chunk.base]! : null;
  }

  selection(ids: ReadonlySet<number>): Uint8Array {
    const hits = new Uint8Array(this.data.centers.length / 3);
    const selected = this.mappings.map(() => new Set<number>());
    for (const id of ids) {
      const chunk = this.chunks.find(chunk => id >= chunk.base && id < chunk.base + chunk.count);
      if (!chunk) continue;
      selected[chunk.level]!.add(chunk.offset + id - chunk.base);
      hits[this.canonicalId(id)!] = 1;
    }
    for (const [level, indices] of selected.entries()) if (indices.size) {
      const mapping = this.mappings[level]!.to;
      for (let index = 0; index < hits.length; index++) if (indices.has(mapping[index]!)) hits[index] = 1;
    }
    return hits;
  }

  modifier(base: { glsl: string; wgsl: string }) {
    return {
      glsl: `uniform uint portalEditWidth;
        ivec2 portalUV() { uint index = loadPortalIdsSource().r; return ivec2(index % portalEditWidth, index / portalEditWidth); }
        ${base.glsl.replaceAll("splat.uv", "portalUV()").replace("void modifySplatCenter(inout vec3 center) {}",
          "void modifySplatCenter(inout vec3 center) { writePortalIds(loadPortalIdsSource()); }")}`,
      wgsl: `uniform portalEditWidth: u32;
        fn portalUV() -> vec2i { let index = loadPortalIdsSource().r; return vec2i(i32(index % uniform.portalEditWidth), i32(index / uniform.portalEditWidth)); }
        ${base.wgsl.replaceAll("splat.uv", "portalUV()").replace("fn modifySplatCenter(center: ptr<function, vec3f>) {}",
          "fn modifySplatCenter(center: ptr<function, vec3f>) { writePortalIds(loadPortalIdsSource()); }")}`
    };
  }

  destroy() {
    if (this.disposed) return; this.disposed = true;
    for (const cancel of this.pending) cancel();
    this.app.assets.off("load", this.loaded, this);
    if (this.enabled) this.app.scene.gsplat.format.removeExtraStreams(["portalIds"]);
  }
}
