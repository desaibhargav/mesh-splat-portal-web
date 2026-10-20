import { z } from "zod";

const localFile = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/);
const schema = z.object({
  version: z.literal(1), kind: z.enum(["mesh", "splat"]), stream: localFile.optional(),
  levels: z.array(z.object({ level: z.number().int().nonnegative(), ratio: z.number().positive().max(0.7),
    count: z.number().int().positive(), file: localFile.optional() })).length(3),
  editing: z.object({ centers: localFile, parts: z.array(z.array(z.number().int().positive()).min(1)).length(3),
    levels: z.array(z.union([z.object({ identity: z.literal(true) }), z.object({ to: localFile, from: localFile })])).length(3),
    chunks: z.array(z.object({ file: z.number().int().nonnegative(), level: z.number().int().min(0).max(2),
      offset: z.number().int().nonnegative(), count: z.number().int().positive() }))
  })
});

export interface LodMapping { to: Uint32Array; from: Uint32Array; parts: readonly number[] }
export type LodDescriptor = z.infer<typeof schema>;

// Canonical IDs belong to the finest published derivative, never the master.
// Fetch index maps once; no spatial searches are performed while navigating.
export class LodData {
  readonly centers: Float32Array;
  private readonly mappings = new Map<number, Promise<LodMapping>>();
  private readonly resolved = new Map<number, LodMapping>();
  private constructor(readonly url: string, readonly descriptor: LodDescriptor, centers: ArrayBuffer) {
    if (descriptor.kind === "mesh" ? descriptor.levels.some(level => !level.file) : !descriptor.stream) {
      throw new Error("LOD content location is missing.");
    }
    const count = descriptor.editing.parts[0]!.reduce((sum, size) => sum + size, 0);
    if (centers.byteLength !== count * 12) throw new Error("LOD centre count does not match metadata.");
    this.centers = new Float32Array(centers);
    if (!this.centers.every(Number.isFinite)) throw new Error("Invalid LOD coordinates.");
    descriptor.levels.forEach((level, index) => {
      if (level.level !== index || level.ratio !== [0.7, 0.5, 0.3][index]) throw new Error("Unexpected LOD policy or ordering.");
      if (level.count !== descriptor.editing.parts[index]!.reduce((sum, size) => sum + size, 0)) {
        throw new Error("LOD primitive count differs from correspondence metadata.");
      }
    });
    const offsets = [0, 0, 0], files = new Set<number>();
    for (const chunk of descriptor.editing.chunks) {
      if (files.has(chunk.file) || chunk.offset !== offsets[chunk.level]) throw new Error("Invalid streamed chunk ordering.");
      files.add(chunk.file); offsets[chunk.level]! += chunk.count;
    }
    if (descriptor.kind === "mesh" ? files.size > 0 : offsets.some((size, index) => size !== descriptor.levels[index]!.count)) {
      throw new Error("Streamed chunks do not cover the LOD geometry.");
    }
  }

  static async load(url: string, signal: AbortSignal): Promise<LodData> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`LOD metadata request failed (${response.status}).`);
    const descriptor = schema.parse(await response.json());
    const location = new URL(url, window.location.href).href;
    const centers = await fetchBinary(new URL(descriptor.editing.centers, location).href, signal);
    const data = new LodData(location, descriptor, centers);
    await Promise.all(descriptor.levels.map(level => data.mapping(level.level, signal)));
    return data;
  }

  file(path: string): string { return new URL(localFile.parse(path), this.url).href; }
  mapping(level: number, signal: AbortSignal): Promise<LodMapping> {
    let pending = this.mappings.get(level);
    if (!pending) {
      const entry = this.descriptor.editing.levels[level];
      const parts = this.descriptor.editing.parts[level];
      if (!entry || !parts) throw new Error("Invalid LOD index.");
      if ("identity" in entry) {
        if (level !== 0) throw new Error("Only the canonical LOD can have an identity mapping.");
        const indices = Uint32Array.from({ length: this.centers.length / 3 }, (_, index) => index);
        const result = { to: indices, from: indices, parts };
        this.resolved.set(level, result); pending = Promise.resolve(result);
        this.mappings.set(level, pending); return pending;
      }
      pending = Promise.all([fetchBinary(this.file(entry.to), signal), fetchBinary(this.file(entry.from), signal)])
        .then(([to, from]) => {
          const fine = this.centers.length / 3, coarse = parts.reduce((sum, size) => sum + size, 0);
          if (to.byteLength !== fine * 4 || from.byteLength !== coarse * 4) throw new Error("Invalid LOD correspondence size.");
          const result = { to: new Uint32Array(to), from: new Uint32Array(from), parts };
          if (!result.to.every(index => index < coarse) || !result.from.every(index => index < fine)) {
            throw new Error("LOD correspondence index is out of bounds.");
          }
          this.resolved.set(level, result);
          return result;
        }).catch(error => { this.mappings.delete(level); throw error; });
      this.mappings.set(level, pending);
    }
    return pending;
  }
  readyMapping(level: number): LodMapping {
    const mapping = this.resolved.get(level);
    if (!mapping) throw new Error("LOD mapping has not been prepared.");
    return mapping;
  }
}

async function fetchBinary(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`LOD data request failed (${response.status}).`);
  return response.arrayBuffer();
}
