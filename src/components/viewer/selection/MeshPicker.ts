import {
  CULLFACE_NONE, Color, Layer, Mesh, MeshInstance, PIXELFORMAT_RGBA8, PRIMITIVE_TRIANGLES, RenderPassPicker, RenderTarget,
  SEMANTIC_COLOR, SEMANTIC_POSITION, ShaderMaterial, Texture, TYPE_UINT8,
  type AppBase, type CameraComponent
} from "playcanvas";
import type { SelectionRegion } from "./types";
import { sectionDeclaration } from "../section/sectionShaders";

interface PickPart { source: MeshInstance; positions: Float32Array; indices: number[]; mask: Uint8Array }
interface PickImage { pixels: Uint8Array; left: number; top: number; width: number; height: number; screenWidth: number; screenHeight: number; flipY: boolean }

export function facesInRegion(image: PickImage, region: SelectionRegion, counts: number[]): Uint8Array[] {
  const masks = counts.map(count => new Uint8Array(count));
  let total = 0;
  const offsets = counts.map(count => { const start = total; total += count; return start; });
  for (let y = 0; y < image.height; y++) {
    const maskRow = Math.floor((image.top + y + .5) * region.height / image.screenHeight) * region.width;
    const row = (image.flipY ? image.height - 1 - y : y) * image.width;
    for (let x = 0; x < image.width; x++) {
      const maskX = Math.floor((image.left + x + .5) * region.width / image.screenWidth);
      if (!region.pixels[(maskRow + maskX) * 4 + 3]) continue;
      const pixel = (row + x) * 4, data = image.pixels;
      const id = (data[pixel]! | (data[pixel + 1]! << 8) | (data[pixel + 2]! << 16) | (data[pixel + 3]! << 24)) >>> 0;
      if (id >= total) continue;
      let low = 0, high = counts.length;
      while (low + 1 < high) { const middle = (low + high) >>> 1; if (offsets[middle]! <= id) low = middle; else high = middle; }
      masks[low]![id - offsets[low]!] = 255;
    }
  }
  return masks;
}

function regionBounds(region: SelectionRegion) {
  let left = region.width, top = region.height, right = 0, bottom = 0;
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) if (region.pixels[(y * region.width + x) * 4 + 3]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return { left, top, right, bottom };
}

// PlayCanvas supplies depth testing, culling, render submission and asynchronous readback.
// The small ID shader identifies triangles instead of whole MeshInstances.
export class MeshPicker {
  private readonly layer = new Layer({ name: "Triangle selection" });
  private readonly pass: RenderPassPicker;
  private readonly instances: MeshInstance[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private texture?: Texture;
  private target?: RenderTarget;
  private disposed = false;
  private signature = "";

  constructor(private readonly app: AppBase, private readonly parts: PickPart[]) {
    this.pass = new RenderPassPicker(app.graphicsDevice, app.renderer);
    let offset = 0;
    for (const part of parts) {
      const positions = new Float32Array(part.indices.length * 3), colors = new Uint8Array(part.indices.length * 4);
      part.indices.forEach((index, vertex) => {
        positions.set(part.positions.subarray(index * 3, index * 3 + 3), vertex * 3);
        const id = offset + Math.floor(vertex / 3);
        for (let byte = 0; byte < 4; byte++) colors[vertex * 4 + byte] = (id >>> (byte * 8)) & 255;
      });
      const mesh = new Mesh(app.graphicsDevice);
      mesh.setPositions(positions);
      mesh.setVertexStream(SEMANTIC_COLOR, colors, 4, undefined, TYPE_UINT8, true);
      mesh.update(PRIMITIVE_TRIANGLES);
      const material = new ShaderMaterial({
        uniqueName: "PortalTriangleIDs",
        attributes: { vertex_position: SEMANTIC_POSITION, vertex_color: SEMANTIC_COLOR },
        vertexGLSL: `attribute vec3 vertex_position; attribute vec4 vertex_color;
          uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; varying vec4 faceId; varying vec3 sectionWorld;
          void main() { vec4 world = matrix_model * vec4(vertex_position, 1.0); gl_Position = matrix_viewProjection * world; sectionWorld = world.xyz; faceId = vertex_color; }`,
        fragmentGLSL: `${sectionDeclaration.glsl}\nvarying vec3 sectionWorld; varying vec4 faceId; void main() { if (portalSectionClipped(sectionWorld)) { discard; } pcFragColor0 = faceId; }`,
        vertexWGSL: `attribute vertex_position: vec3f; attribute vertex_color: vec4f;
          uniform matrix_model: mat4x4f; uniform matrix_viewProjection: mat4x4f; varying faceId: vec4f; varying sectionWorld: vec3f;
          @vertex fn vertexMain(input: VertexInput) -> VertexOutput { var output: VertexOutput;
            let world = uniform.matrix_model * vec4f(input.vertex_position, 1.0);
            output.position = uniform.matrix_viewProjection * world; output.sectionWorld = world.xyz;
            output.faceId = input.vertex_color; return output; }`,
        fragmentWGSL: `${sectionDeclaration.wgsl}\nvarying faceId: vec4f; varying sectionWorld: vec3f;
          @fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput { var output: FragmentOutput; if (portalSectionClipped(input.sectionWorld)) { discard; } output.color = input.faceId; return output; }`
      });
      material.cull = part.source.material.cull;
      this.materials.push(material);
      this.instances.push(new MeshInstance(mesh, material, part.source.node));
      offset += part.mask.length;
    }
    this.layer.addMeshInstances(this.instances);
    app.scene.layers.push(this.layer);
  }

  private prepare(camera: CameraComponent, isolated: boolean) {
    const device = this.app.graphicsDevice;
    const signature = [device.width, device.height, ...camera.projectionMatrix.data, ...camera.viewMatrix.data].join();
    if (signature === this.signature) return;
    if (this.texture?.width !== device.width || this.texture.height !== device.height) {
      this.target?.destroy(); this.texture?.destroy();
      this.texture = Texture.createDataTexture2D(device, "Triangle IDs", device.width, device.height, PIXELFORMAT_RGBA8);
      this.target = new RenderTarget({ colorBuffer: this.texture, depth: true });
      this.pass.init(this.target);
      this.pass.setClearColor(Color.WHITE); this.pass.depthStencilOps.clearDepth = true;
    }
    this.parts.forEach((part, i) => {
      const instance = this.instances[i]!;
      this.materials[i]!.cull = this.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue() ? CULLFACE_NONE : part.source.material.cull;
      instance.visible = !isolated || part.mask.some(Boolean);
      if (!isolated) {
        Object.assign(instance.mesh.primitive[0]!, { indexed: false, base: 0, count: instance.mesh.vertexBuffer.numVertices });
        return;
      }
      const indices: number[] = [];
      for (let face = 0; face < part.mask.length; face++) if (part.mask[face]) indices.push(face * 3, face * 3 + 1, face * 3 + 2);
      if (indices.length) { instance.mesh.setIndices(indices); instance.mesh.update(PRIMITIVE_TRIANGLES, false); }
    });
    const layers = camera.layers;
    try {
      camera.layers = [...layers, this.layer.id];
      this.pass.update(camera, this.app.scene, [this.layer], new Map(), false);
      this.pass.render();
    } finally { camera.layers = layers; }
    this.signature = signature;
  }

  async primitiveAt(camera: CameraComponent, u: number, v: number, isolated: boolean): Promise<{ part: number; index: number } | null> {
    this.prepare(camera, isolated);
    const x = Math.floor(u * this.texture!.width), y = Math.floor(v * this.texture!.height);
    const bytes = await this.texture!.read(x, this.app.graphicsDevice.isWebGPU ? y : this.texture!.height - y - 1, 1, 1, { immediate: true, renderTarget: this.target });
    if (this.disposed) return null;
    const data = bytes as Uint8Array;
    let index = (data[0]! | data[1]! << 8 | data[2]! << 16 | data[3]! << 24) >>> 0;
    for (const [part, source] of this.parts.entries()) {
      if (index < source.mask.length) return { part, index };
      index -= source.mask.length;
    }
    return null;
  }

  async capture(camera: CameraComponent, region: SelectionRegion, isolated: boolean): Promise<Uint8Array[]> {
    const bounds = regionBounds(region);
    if (bounds.right === 0) return this.parts.map(part => new Uint8Array(part.mask.length));
    this.prepare(camera, isolated);
    const device = this.app.graphicsDevice;
    const screenWidth = this.texture!.width, screenHeight = this.texture!.height;
    const left = Math.floor(bounds.left * screenWidth / region.width), top = Math.floor(bounds.top * screenHeight / region.height);
    const width = Math.ceil(bounds.right * screenWidth / region.width) - left, height = Math.ceil(bounds.bottom * screenHeight / region.height) - top;
    const flipY = !device.isWebGPU;
    const pixels = await this.texture!.read(left, flipY ? screenHeight - top - height : top, width, height, { immediate: true, renderTarget: this.target });
    if (this.disposed) throw new Error("Viewer closed during selection.");
    return facesInRegion({ pixels: pixels as Uint8Array, left, top, width, height, screenWidth, screenHeight, flipY }, region, this.parts.map(part => part.mask.length));
  }

  invalidate() { this.signature = ""; }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.app.scene.layers.remove(this.layer);
    this.layer.removeMeshInstances(this.instances);
    for (const instance of this.instances) instance.destroy();
    for (const material of this.materials) material.destroy();
    this.pass.destroy(); this.target?.destroy(); this.texture?.destroy();
  }
}
