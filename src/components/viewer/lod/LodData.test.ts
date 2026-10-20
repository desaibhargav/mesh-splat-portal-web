import { afterEach, describe, expect, it, vi } from "vitest";
import { LodData, type LodDescriptor } from "./LodData";

function descriptor(): LodDescriptor {
  return { version: 1, kind: "mesh", levels: [0.7, 0.5, 0.3].map((ratio, level) => ({
    level, ratio, count: 4 - level, file: `lod/${level}/content.glb`
  })), editing: { centers: "editing/centers.bin.gz", parts: [[2, 2], [3], [2]], chunks: [],
    levels: [{ identity: true }, { to: "to-1", from: "from-1" }, { to: "to-2", from: "from-2" }] } };
}
function serve(meta: LodDescriptor, overrides: Record<string, ArrayBuffer> = {}) {
  const files: Record<string, ArrayBuffer> = {
    "editing/centers.bin.gz": new Float32Array(12).buffer,
    "to-1": new Uint32Array([0, 1, 1, 2]).buffer, "from-1": new Uint32Array([0, 2, 3]).buffer,
    "to-2": new Uint32Array([0, 0, 1, 1]).buffer, "from-2": new Uint32Array([0, 3]).buffer, ...overrides
  };
  vi.stubGlobal("window", { location: { href: "https://portal.example/artifacts/test" } });
  return vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    options.signal?.throwIfAborted();
    const name = new URL(url, "https://portal.example").pathname.replace("/files/asset/", "");
    if (name === "lod.json") return Response.json(meta);
    return files[name] ? new Response(files[name]) : new Response(null, { status: 404 });
  }));
}
const load = () => LodData.load("/files/asset/lod.json", new AbortController().signal);
afterEach(() => vi.unstubAllGlobals());

describe("published LOD data contract", () => {
  it("loads correspondence once, derives identity locally and supports different mesh part counts", async () => {
    serve(descriptor());
    const data = await load(), signal = new AbortController().signal;
    expect(data.readyMapping(0).to).toEqual(new Uint32Array([0, 1, 2, 3]));
    expect(data.readyMapping(0).from).toBe(data.readyMapping(0).to);
    expect(data.readyMapping(1).parts).toEqual([3]);
    expect(await data.mapping(1, signal)).toBe(await data.mapping(1, signal));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(data.file("lod/2/content.glb")).toBe("https://portal.example/files/asset/lod/2/content.glb");
    expect(() => data.file("../master.ply")).toThrow();
  });
  it.each([
    ["unordered levels", (m: LodDescriptor) => { m.levels[1]!.level = 2; }],
    ["missing content", (m: LodDescriptor) => { delete m.levels[1]!.file; }],
    ["inconsistent counts", (m: LodDescriptor) => { m.editing.parts[1] = [8]; }],
    ["noncanonical identity", (m: LodDescriptor) => { m.editing.levels[1] = { identity: true }; }],
    ["unexpected mesh chunks", (m: LodDescriptor) => { m.editing.chunks = [{ file: 0, level: 0, offset: 0, count: 4 }]; }]
  ])("rejects %s", async (_, change) => {
    const meta = descriptor(); change(meta); serve(meta); await expect(load()).rejects.toThrow();
  });
  it.each<Record<string, ArrayBuffer>>([
    { "from-1": new Uint32Array([0, 2, 4]).buffer },
    { "to-2": new Uint32Array([0, 0, 1]).buffer },
    { "editing/centers.bin.gz": new Float32Array([NaN, ...Array(11).fill(0)]).buffer }
  ])("rejects malformed coordinates or indices", async overrides => {
    serve(descriptor(), overrides); await expect(load()).rejects.toThrow();
  });
  it("does not complete a load after cancellation", async () => {
    serve(descriptor()); const controller = new AbortController(); controller.abort();
    await expect(LodData.load("/files/asset/lod.json", controller.signal)).rejects.toThrow();
  });
  it("validates native chunk coverage independently of file order", async () => {
    const meta = descriptor(); meta.kind = "splat"; meta.stream = "stream/lod-meta.json";
    meta.editing.chunks = [
      { file: 2, level: 0, offset: 0, count: 2 }, { file: 0, level: 0, offset: 2, count: 2 },
      { file: 3, level: 1, offset: 0, count: 3 }, { file: 1, level: 2, offset: 0, count: 2 }
    ];
    serve(meta); expect((await load()).descriptor.editing.chunks).toHaveLength(4);
    meta.editing.chunks[1]!.offset = 1;
    serve(meta); await expect(load()).rejects.toThrow("chunk ordering");
    meta.editing.chunks[1]!.offset = 2; meta.editing.chunks.pop();
    serve(meta); await expect(load()).rejects.toThrow("do not cover");
  });
});
