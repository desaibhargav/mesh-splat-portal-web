import {
  CULLFACE_NONE, Color, Layer, Mat4, Mesh, MeshInstance, PIXELFORMAT_RGBA8, PRIMITIVE_TRIANGLES, RenderPassPicker, RenderTarget,
  SEMANTIC_POSITION, ShaderMaterial, Texture,
  type AppBase, type CameraComponent
} from "playcanvas";
import { renderPickView } from "../picking/PickView";
import { viewportPoint } from "../viewports/ViewerViewports";
import type { SelectionRegion } from "./types";
import { sectionDeclaration } from "../section/sectionShaders";
import { faceId, facesInMask, regionAlpha, type PickImage } from "./pickImage";

interface PickPart { source: MeshInstance; positions: Float32Array; indices: number[]; mask: Uint8Array; scope: Uint8Array | null }
interface PickCrop { left: number; top: number; width: number; height: number }

export function facesInRegion(image: PickImage, region: SelectionRegion, counts: number[]): Uint8Array[] {
  return facesInMask(image, regionAlpha(region), region.width, region.height, counts);
}

function regionBounds(region: SelectionRegion) {
  let left = region.width, top = region.height, right = 0, bottom = 0;
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) if (region.pixels[(y * region.width + x) * 4 + 3]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return { left, top, right, bottom };
}

// Spend the picking budget on the gesture's bounds, not the entire viewport.
// The 4 Mi-pixel RGBA8/depth target costs about 32 MiB, excluding readback.
// Native targets already above that budget retain their existing resolution.
export function selectionPickScale(width: number, height: number, maxTextureSize: number): number {
  return Math.min(maxTextureSize / Math.max(width, height),
    Math.max(1, Math.sqrt(4 * 1024 * 1024 / (width * height))));
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
  private geometryDirty = true;

  constructor(private readonly app: AppBase, private readonly parts: PickPart[]) {
    this.pass = new RenderPassPicker(app.graphicsDevice, app.renderer);
    let offset = 0;
    for (const part of parts) {
      const positions = new Float32Array(part.indices.length * 3);
      for (let vertex = 0; vertex < part.indices.length; vertex++) {
        const source = part.indices[vertex]! * 3, target = vertex * 3;
        positions[target] = part.positions[source]!; positions[target + 1] = part.positions[source + 1]!; positions[target + 2] = part.positions[source + 2]!;
      }
      const mesh = new Mesh(app.graphicsDevice);
      mesh.setPositions(positions);
      mesh.update(PRIMITIVE_TRIANGLES);
      const material = new ShaderMaterial({
        uniqueName: "PortalTriangleIDs",
        attributes: { vertex_position: SEMANTIC_POSITION },
        vertexGLSL: `attribute vec3 vertex_position;
          uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform uint portalFaceOffset; flat varying uint triangleId; varying vec3 sectionWorld;
          void main() { vec4 world = matrix_model * vec4(vertex_position, 1.0); gl_Position = matrix_viewProjection * world; sectionWorld = world.xyz; triangleId = uint(gl_VertexID) / 3u + portalFaceOffset; }`,
        fragmentGLSL: `${sectionDeclaration.glsl}\n#define PICK_CUSTOM_ID\n#include "pickPS"\nvarying vec3 sectionWorld; flat varying uint triangleId;
          void main() { if (portalSectionClipped(sectionWorld)) { discard; } pcFragColor0 = encodePickOutput(triangleId); }`,
        vertexWGSL: `attribute vertex_position: vec3f;
          uniform matrix_model: mat4x4f; uniform matrix_viewProjection: mat4x4f; uniform portalFaceOffset: u32; varying @interpolate(flat) triangleId: u32; varying sectionWorld: vec3f;
          @vertex fn vertexMain(input: VertexInput) -> VertexOutput { var output: VertexOutput;
            let world = uniform.matrix_model * vec4f(input.vertex_position, 1.0);
            output.position = uniform.matrix_viewProjection * world; output.sectionWorld = world.xyz;
            output.triangleId = input.vertexIndex / 3u + uniform.portalFaceOffset; return output; }`,
        fragmentWGSL: `${sectionDeclaration.wgsl}\n#define PICK_CUSTOM_ID\n#include "pickPS"\nvarying @interpolate(flat) triangleId: u32; varying sectionWorld: vec3f;
          @fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput { var output: FragmentOutput; if (portalSectionClipped(input.sectionWorld)) { discard; } output.color = encodePickOutput(input.triangleId); return output; }`
      });
      material.cull = part.source.material.cull;
      material.setParameter("portalFaceOffset", offset);
      this.materials.push(material);
      this.instances.push(new MeshInstance(mesh, material, part.source.node));
      offset += part.mask.length;
    }
    this.layer.addMeshInstances(this.instances);
    app.scene.layers.push(this.layer);
  }

  private prepare(camera: CameraComponent, isolated: boolean, scale = 1, crop?: PickCrop) {
    const device = this.app.graphicsDevice;
    const width = Math.max(1, Math.floor(device.width * camera.rect.z * scale * (crop?.width ?? 1))), height = Math.max(1, Math.floor(device.height * camera.rect.w * scale * (crop?.height ?? 1)));
    const signature = [width, height, crop?.left, crop?.top, crop?.width, crop?.height, ...camera.projectionMatrix.data, ...camera.viewMatrix.data,
      ...this.parts.flatMap(part => Array.from(part.source.node.getWorldTransform().data))].join();
    if (signature === this.signature) return;
    if (this.texture?.width !== width || this.texture.height !== height) {
      this.target?.destroy(); this.texture?.destroy();
      this.texture = Texture.createDataTexture2D(device, "Triangle IDs", width, height, PIXELFORMAT_RGBA8);
      this.target = new RenderTarget({ colorBuffer: this.texture, depth: true });
      this.pass.init(this.target);
      this.pass.setClearColor(Color.WHITE); this.pass.depthStencilOps.clearDepth = true;
    }
    if (this.geometryDirty) this.parts.forEach((part, i) => {
      const instance = this.instances[i]!;
      this.materials[i]!.cull = this.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue() ? CULLFACE_NONE : part.source.material.cull;
      instance.visible = (!part.scope || part.scope.some(Boolean)) && (!isolated || part.mask.some(Boolean));
      if (!isolated && !part.scope) {
        Object.assign(instance.mesh.primitive[0]!, { indexed: false, base: 0, count: part.indices.length });
        return;
      }
      const indices: number[] = [];
      for (let face = 0; face < part.mask.length; face++) if ((!part.scope || part.scope[face]) && (!isolated || part.mask[face])) indices.push(face * 3, face * 3 + 1, face * 3 + 2);
      if (indices.length) { instance.mesh.setIndices(indices); instance.mesh.update(PRIMITIVE_TRIANGLES, false); }
    });
    this.geometryDirty = false;
    const layers = camera.layers, calculateProjection = camera.calculateProjection;
    try {
      if (crop) {
        const matrix = new Mat4().setScale(1 / crop.width, 1 / crop.height, 1);
        matrix.data[12] = (1 - 2 * crop.left - crop.width) / crop.width;
        matrix.data[13] = (2 * crop.top + crop.height - 1) / crop.height;
        const projection = new Mat4().mul2(matrix, camera.projectionMatrix);
        camera.calculateProjection = target => target.copy(projection);
      }
      camera.layers = [...layers, this.layer.id];
      renderPickView(camera, () => {
        this.pass.update(camera, this.app.scene, [this.layer], new Map(), false); this.pass.render();
      });
    } finally { camera.layers = layers; camera.calculateProjection = calculateProjection; }
    this.signature = signature;
  }

  async primitiveAt(camera: CameraComponent, u: number, v: number, isolated: boolean): Promise<{ part: number; index: number } | null> {
    const local = viewportPoint(camera, u, v); u = local.u; v = local.v;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    this.prepare(camera, isolated);
    const x = Math.floor(u * this.texture!.width), y = Math.floor(v * this.texture!.height);
    const bytes = await this.texture!.read(x, this.app.graphicsDevice.isWebGPU ? y : this.texture!.height - y - 1, 1, 1, { immediate: true, renderTarget: this.target });
    if (this.disposed) return null;
    const data = bytes as Uint8Array;
    let index = faceId(data);
    for (const [part, source] of this.parts.entries()) {
      if (index < source.mask.length) return { part, index };
      index -= source.mask.length;
    }
    return null;
  }

  async capture(camera: CameraComponent, region: SelectionRegion, isolated: boolean): Promise<Uint8Array[]> {
    const image = await this.captureImage(camera, region, isolated);
    const counts = this.parts.map(part => part.mask.length);
    return image ? facesInRegion(image, region, counts) : counts.map(count => new Uint8Array(count));
  }

  async captureImage(camera: CameraComponent, region: SelectionRegion, isolated: boolean): Promise<PickImage | null> {
    const bounds = regionBounds(region);
    if (bounds.right === 0) return null;
    const device = this.app.graphicsDevice;
    const viewWidth = device.width * camera.rect.z, viewHeight = device.height * camera.rect.w;
    const crop = { left: bounds.left / region.width, top: bounds.top / region.height, width: (bounds.right - bounds.left) / region.width, height: (bounds.bottom - bounds.top) / region.height };
    const cropWidth = viewWidth * crop.width, cropHeight = viewHeight * crop.height;
    const scale = selectionPickScale(cropWidth, cropHeight, device.maxTextureSize);
    this.prepare(camera, isolated, scale, crop);
    const width = this.texture!.width, height = this.texture!.height;
    const pixels = await this.texture!.read(0, 0, width, height, { immediate: true, renderTarget: this.target });
    if (this.disposed) throw new Error("Viewer closed during selection.");
    return { pixels: pixels as Uint8Array, left: crop.left * width / crop.width, top: crop.top * height / crop.height, width, height,
      screenWidth: width / crop.width, screenHeight: height / crop.height, flipY: !device.isWebGPU };
  }

  invalidate() { this.signature = ""; this.geometryDirty = true; }
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
