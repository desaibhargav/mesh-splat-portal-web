import { PointSurfaceQuery } from "./PointSurfaceQuery";
import { MeshVisibilityQuery } from "./MeshVisibilityQuery";
import type { SurfaceRayQuery, VisibilityGeometry, VisibilityQuery, VolumeQuery } from "./visibilityTypes";
import { facesInMask, type PickImage } from "../pickImage";

let geometry: MeshVisibilityQuery | PointSurfaceQuery;
let counts: number[];
let rayVisibility: (Uint8Array | null)[] = [];
self.onmessage = ({ data }: MessageEvent<{ id: number; points?: Float32Array; geometry?: VisibilityGeometry[]; query?: Omit<VisibilityQuery, "hits">;
  image?: PickImage | null; ray?: SurfaceRayQuery; visible?: (Uint8Array | null)[]; volume?: VolumeQuery }>) => {
  try {
    if (data.points) { geometry = new PointSurfaceQuery(data.points); return; }
    if (data.geometry) { geometry = new MeshVisibilityQuery(data.geometry); counts = data.geometry.map(part => part.indices.length / 3); return; }
    if (data.ray) {
      if (data.visible) rayVisibility = data.visible;
      self.postMessage({ id: data.id, hit: geometry.surfaceHit(data.ray, rayVisibility) }); return;
    }
    if (data.volume) {
      const result = geometry.selectVolume(data.volume);
      self.postMessage({ id: data.id, result }, { transfer: result.map(mask => mask.buffer as ArrayBuffer) }); return;
    }
    const query = data.query!;
    const hits = data.image ? facesInMask(data.image, query.alpha, query.width, query.height, counts) : counts.map(count => new Uint8Array(count));
    const result = (geometry as MeshVisibilityQuery).select({ ...query, hits });
    self.postMessage({ id: data.id, result }, { transfer: result.map(mask => mask.buffer as ArrayBuffer) });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
