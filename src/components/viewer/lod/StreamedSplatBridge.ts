import { GSPLAT_STREAM_RESOURCE, PIXELFORMAT_R32U, type AppBase, type Asset, type GSplatComponent,
  type GSplatResourceBase } from "playcanvas";
import type { LodData, LodMapping } from "./LodData";

interface Chunk { file: number; level: number; offset: number; count: number; base: number; url: string }

// Uses native resource/work-buffer streams. The engine still owns spatial LOD,
// loading, sorting and draw submission; IDs only connect its chunks to edit data.
export class StreamedSplatBridge {
  private readonly chunks: Chunk[];
  private readonly prepared = new WeakSet<GSplatResourceBase>();
  private disposed = false;
  private constructor(private readonly app: AppBase, readonly data: LodData, readonly mappings: readonly LodMapping[],
    private readonly onError: (error: Error) => void) {
    let base = 0;
    this.chunks = data.descriptor.editing.chunks.map(chunk => {
      const result = { ...chunk, base, url: "" }; base += chunk.count; return result;
    });
    if (base >= 0xffffffff) throw new Error("Streamed picking exceeds the supported ID range.");
    app.scene.gsplat.format.addExtraStreams([{ name: "portalPick", format: PIXELFORMAT_R32U }]);
    app.assets.on("load", this.loaded, this);
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
    for (const asset of component.system.app.assets.list()) bridge.loaded(asset);
    return bridge;
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
    resource.format.addExtraStreams([
      { name: "portalCanonicalSource", format: PIXELFORMAT_R32U, storage: GSPLAT_STREAM_RESOURCE },
      { name: "portalPickSource", format: PIXELFORMAT_R32U, storage: GSPLAT_STREAM_RESOURCE }
    ]);
    // PlayCanvas 2.21.4 SOG resources assign their stream format at first draw.
    // Synchronize it before filling extra streams so IDs exist on that first draw.
    resource.streams.syncWithFormat(resource.format);
    const canonical = resource.getTexture("portalCanonicalSource")!;
    const ids = resource.getTexture("portalPickSource")!;
    (canonical.lock() as Uint32Array).set(this.mappings[chunk.level]!.from.subarray(chunk.offset, chunk.offset + chunk.count));
    canonical.unlock();
    const pixels = ids.lock() as Uint32Array;
    for (let index = 0; index < chunk.count; index++) pixels[index] = chunk.base + index;
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
        ivec2 portalUV() { uint index = loadPortalCanonicalSource().r; return ivec2(index % portalEditWidth, index / portalEditWidth); }
        ${base.glsl.replaceAll("splat.uv", "portalUV()").replace("void modifySplatCenter(inout vec3 center) {}",
          "void modifySplatCenter(inout vec3 center) { writePortalPick(loadPortalPickSource()); }")}`,
      wgsl: `uniform portalEditWidth: u32;
        fn portalUV() -> vec2i { let index = loadPortalCanonicalSource().r; return vec2i(i32(index % uniform.portalEditWidth), i32(index / uniform.portalEditWidth)); }
        ${base.wgsl.replaceAll("splat.uv", "portalUV()").replace("fn modifySplatCenter(center: ptr<function, vec3f>) {}",
          "fn modifySplatCenter(center: ptr<function, vec3f>) { writePortalPick(loadPortalPickSource()); }")}`
    };
  }

  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.app.assets.off("load", this.loaded, this);
    this.app.scene.gsplat.format.removeExtraStreams(["portalPick"]);
  }
}
