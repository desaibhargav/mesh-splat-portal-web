import { regionBounds } from "./regionBounds";
import type { SelectionRegion } from "./types";
import {
  Picker, ShaderChunks, SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL, TYPE_UINT32,
  type AppBase, type CameraComponent, type RenderTarget, type Texture
} from "playcanvas";
import { splatSectionFragment, splatSectionVertex } from "../section/sectionShaders";

import { renderPickView } from "../picking/PickView";
import { viewportPoint } from "../viewports/ViewerViewports";

type PickerBuffers = { colorBuffer: Texture; renderTarget: RenderTarget };

// PlayCanvas's public Picker handles unified-splat render preparation and depth.
// Its decoded selection intentionally returns components, so this small pinned-version
// adapter reads the already-rendered ID pixel to recover our per-splat source ID.
export class SplatPicker {
  private readonly picker: Picker;
  private signature = "";
  private disposed = false;

  constructor(private readonly app: AppBase, private readonly layers: readonly number[]) {
    this.picker = new Picker(app, app.graphicsDevice.width, app.graphicsDevice.height, true);
    app.on("destroy", this.destroy, this);
  }

  async pick(camera: CameraComponent, u: number, v: number): Promise<number | null> {
    const local = viewportPoint(camera, u, v); u = local.u; v = local.v;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    const device = this.app.graphicsDevice;
    const width = Math.max(1, Math.floor(device.width * camera.rect.z)), height = Math.max(1, Math.floor(device.height * camera.rect.w));
    const signature = [width, height, ...camera.projectionMatrix.data, ...camera.viewMatrix.data].join();
    if (signature !== this.signature) {
      this.picker.resize(width, height);
      renderPickView(camera, () => this.picker.prepare(camera, this.app.scene, this.layers.map(id => this.app.scene.layers.getLayerById(id)!)));
      this.signature = signature;
    }
    const x = Math.floor(u * width), y = Math.floor(v * height);
    const buffers = this.picker as unknown as PickerBuffers;
    const pixels = await buffers.colorBuffer.read(
      x, device.isWebGPU ? y : height - y - 1, 1, 1,
      { immediate: true, renderTarget: buffers.renderTarget }
    ) as Uint8Array;
    if (this.disposed) return null;
    const id = (pixels[3]! << 24 | pixels[0]! << 16 | pixels[1]! << 8 | pixels[2]!) >>> 0;
    return id === 0xffffffff ? null : id;
  }

  invalidate() { this.signature = ""; }

  async capture(camera: CameraComponent, region: SelectionRegion): Promise<Set<number>> {
    const bounds = regionBounds(region);
    if (!bounds.right) return new Set();
    const device = this.app.graphicsDevice;
    const screenWidth = Math.max(1, Math.floor(device.width * camera.rect.z));
    const screenHeight = Math.max(1, Math.floor(device.height * camera.rect.w));
    const left = Math.floor(bounds.left * screenWidth / region.width), top = Math.floor(bounds.top * screenHeight / region.height);
    const width = Math.ceil(bounds.right * screenWidth / region.width) - left;
    const height = Math.ceil(bounds.bottom * screenHeight / region.height) - top;
    this.picker.resize(screenWidth, screenHeight);
    renderPickView(camera, () => this.picker.prepare(camera, this.app.scene, this.layers.map(id => this.app.scene.layers.getLayerById(id)!)));
    const buffers = this.picker as unknown as PickerBuffers;
    const pixels = await buffers.colorBuffer.read(left, device.isWebGPU ? top : screenHeight - top - height, width, height,
      { immediate: true, renderTarget: buffers.renderTarget }) as Uint8Array;
    if (this.disposed) throw new Error("Viewer closed during selection.");
    const ids = new Set<number>();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const selected = (Math.floor((top + y + .5) / screenHeight * region.height) * region.width + Math.floor((left + x + .5) / screenWidth * region.width)) * 4 + 3;
      if (!region.pixels[selected]) continue;
      const offset = ((device.isWebGPU ? y : height - y - 1) * width + x) * 4;
      const id = (pixels[offset + 3]! << 24 | pixels[offset]! << 16 | pixels[offset + 1]! << 8 | pixels[offset + 2]!) >>> 0;
      if (id !== 0xffffffff) ids.add(id);
    }
    this.signature = "";
    return ids;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.app.off("destroy", this.destroy, this);
    this.picker.destroy();
  }
}

export function configureSplatPicking(app: AppBase, streamed = false): () => void {
  const material = app.scene.gsplat.material, previousIds = app.scene.gsplat.enableIds;
  const chunks = [material.shaderChunks.glsl, material.shaderChunks.wgsl] as const;
  const previous = chunks.map(value => ({
    vertex: value.get("gsplatVS"), fragment: value.get("gsplatPS"), modify: value.get("gsplatModifyVS")
  }));
  app.scene.gsplat.varyings.add([{ name: "portalPrimitiveId", type: TYPE_UINT32, components: 1 }]);
  for (const [chunks, language] of [
    [material.shaderChunks.glsl, SHADERLANGUAGE_GLSL],
    [material.shaderChunks.wgsl, SHADERLANGUAGE_WGSL]
  ] as const) {
    const source = ShaderChunks.get(app.graphicsDevice, language).get("gsplatVS")!;
    const languageName = language === SHADERLANGUAGE_GLSL ? "glsl" : "wgsl";
    const customIds = streamed ? "#define GSPLAT_UNIFIED_ID\n#define PICK_CUSTOM_ID\n" : "";
    chunks.set("gsplatVS", customIds + splatSectionVertex(source.replace(
      "loadPcId().r",
      streamed ? "loadPortalIds().g" : language === SHADERLANGUAGE_GLSL ? "user_portalPrimitiveId" : "output.user_portalPrimitiveId"
    ), languageName));
    const fragment = customIds + splatSectionFragment(ShaderChunks.get(app.graphicsDevice, language).get("gsplatPS")!, languageName);
    chunks.set("gsplatPS", languageName === "glsl" ?
      `uniform sampler2D portalHoverMask; uniform float portalHoverOpacity;\n${fragment}`.replace("modifySplatColor(gaussianUV, fragColor);", `modifySplatColor(gaussianUV, fragColor);
        if (portalHoverOpacity > 0.0) {
          uint portalId = getPortalPrimitiveId(); uint portalWidth = uint(textureSize(portalHoverMask, 0).x);
          float portalHovered = texelFetch(portalHoverMask, ivec2(int(portalId % portalWidth), int(portalId / portalWidth)), 0).r;
          fragColor.rgb = mix(fragColor.rgb, vec3(1.0), portalHovered * portalHoverOpacity);
        }`) :
      `var portalHoverMask: texture_2d<f32>; uniform portalHoverOpacity: f32;\n${fragment}`.replace("modifySplatColor(vec2f(gaussianUV), &fragColor);", `modifySplatColor(vec2f(gaussianUV), &fragColor);
        if (uniform.portalHoverOpacity > 0.0) {
          let portalId = getPortalPrimitiveId(); let portalWidth = textureDimensions(portalHoverMask).x;
          let portalHovered = textureLoad(portalHoverMask, vec2i(i32(portalId % portalWidth), i32(portalId / portalWidth)), 0).r;
          fragColor = vec4f(mix(fragColor.rgb, vec3f(1.0), portalHovered * uniform.portalHoverOpacity), fragColor.a);
        }`));
    chunks.set("gsplatModifyVS", language === SHADERLANGUAGE_GLSL ? `
      void modifySplatCenter(inout vec3 center) { setPortalPrimitiveId(${streamed ? "loadPortalIds().r" : "splat.index"}); }
      void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {}
      void modifySplatColor(vec3 center, inout vec4 color) {}` : `
      fn modifySplatCenter(center: ptr<function, vec3f>) { setPortalPrimitiveId(${streamed ? "loadPortalIds().r" : "splat.index"}); }
      fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
      fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {}`);
  }
  app.scene.gsplat.enableIds = !streamed;
  material.update();
  return () => {
    chunks.forEach((value, i) => {
      const source = previous[i]!;
      if (source.vertex === undefined) value.delete("gsplatVS"); else value.set("gsplatVS", source.vertex);
      if (source.fragment === undefined) value.delete("gsplatPS"); else value.set("gsplatPS", source.fragment);
      if (source.modify === undefined) value.delete("gsplatModifyVS"); else value.set("gsplatModifyVS", source.modify);
    });
    app.scene.gsplat.varyings.remove(["portalPrimitiveId"]);
    app.scene.gsplat.enableIds = previousIds;
    material.update();
  };
}
