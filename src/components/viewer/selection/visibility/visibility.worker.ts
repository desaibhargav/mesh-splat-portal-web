import { MeshVisibilityQuery } from "./MeshVisibilityQuery";
import type { VisibilityGeometry, VisibilityQuery } from "./visibilityTypes";
import { facesInMask, type PickImage } from "../pickImage";

let geometry: MeshVisibilityQuery;
let counts: number[];
self.onmessage = ({ data }: MessageEvent<{ id: number; geometry?: VisibilityGeometry[]; query?: Omit<VisibilityQuery, "hits">; image?: PickImage | null }>) => {
  try {
    if (data.geometry) { geometry = new MeshVisibilityQuery(data.geometry); counts = data.geometry.map(part => part.indices.length / 3); return; }
    const query = data.query!;
    const hits = data.image ? facesInMask(data.image, query.alpha, query.width, query.height, counts) : counts.map(count => new Uint8Array(count));
    const result = geometry.select({ ...query, hits });
    self.postMessage({ id: data.id, result }, { transfer: result.map(mask => mask.buffer as ArrayBuffer) });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
