import {
  Color, FILTER_NEAREST, Mat4, PIXELFORMAT_R8, PIXELFORMAT_RGBA8, Texture, WORKBUFFER_UPDATE_ONCE,
  type AppBase, type CameraComponent, type GSplatComponent
} from "playcanvas";
import { paintSelection, decodeColor, type PaintState } from "./selectionColors";
import type { SelectionOperation } from "./rectangle";
import { applySelection, projectSelection } from "./projectSelection";
import { captureDepth, depthTest } from "./SelectionDepth";
import type { SelectionCamera, SelectionRegion, SelectionState, SelectionSummary } from "./types";

import { SplatPicker, configureSplatPicking } from "./SplatPicker";
import { SelectionBounds } from "./selectionBounds";

const modifier = {
  glsl: `
uniform sampler2D portalSelection;
uniform sampler2D portalPaint;
uniform vec4 portalSelectionTint;
uniform float portalIsolate;
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {}
void modifySplatColor(vec3 center, inout vec4 color) {
    vec3 selectionTint = portalSelectionTint.rgb;
    vec4 paint = texelFetch(portalPaint, splat.uv, 0);
    if (paint.a > 0.0) {
        color.rgb = mix(color.rgb, paint.rgb, paint.a);
        selectionTint = paint.rgb;
    }
    float selected = texelFetch(portalSelection, splat.uv, 0).r;
    color.rgb = mix(color.rgb, selectionTint, selected * portalSelectionTint.a);
    color.a *= mix(1.0, selected, portalIsolate);
}`,
  wgsl: `
var portalSelection: texture_2d<f32>;
var portalPaint: texture_2d<f32>;
uniform portalSelectionTint: vec4f;
uniform portalIsolate: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    var selectionTint = uniform.portalSelectionTint.rgb;
    let paint = textureLoad(portalPaint, vec2i(splat.uv), 0);
    if (paint.a > 0.0) {
        (*color) = vec4f(mix((*color).rgb, paint.rgb, paint.a), (*color).a);
        selectionTint = paint.rgb;
    }
    let selected = textureLoad(portalSelection, vec2i(splat.uv), 0).r;
    (*color) = vec4f(mix((*color).rgb, selectionTint, selected * uniform.portalSelectionTint.a),
        (*color).a * mix(1.0, selected, uniform.portalIsolate));
}`
};

export class SplatSelection {
  private readonly texture: Texture;
  private readonly paintTexture: Texture;
  private paintState: PaintState;
  private uploadedColors: Uint32Array;
  private readonly centers: Float32Array;
  private readonly mask: Uint8Array;
  private disposed = false;
  private picker?: SplatPicker;
  private readonly releasePicking: () => void;
  private selected = 0;
  private isolated = false;

  constructor(private readonly component: GSplatComponent, private readonly tint: Color) {
    const resource = component.resource;
    if (!resource?.hasCenters) throw new Error("This splat has no selectable center data.");
    this.releasePicking = configureSplatPicking(component.system.app);
    this.centers = resource.centers;
    this.mask = new Uint8Array(this.centers.length / 3);
    this.texture = new Texture(resource.device, {
      name: "Portal selection", width: resource.textureDimensions.x, height: resource.textureDimensions.y,
      format: PIXELFORMAT_R8, mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST
    });
    (this.texture.lock() as Uint8Array).fill(0);
    this.texture.unlock();
    this.paintState = [new Uint32Array(this.mask.length)]; this.uploadedColors = this.paintState[0]!;
    this.paintTexture = new Texture(resource.device, {
      name: "Portal paint", width: resource.textureDimensions.x, height: resource.textureDimensions.y,
      format: PIXELFORMAT_RGBA8, mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST
    });
    (this.paintTexture.lock() as Uint8Array).fill(0); this.paintTexture.unlock();
    component.setParameter("portalPaint", this.paintTexture);
    component.setParameter("portalSelection", this.texture);
    component.setParameter("portalSelectionTint", new Float32Array([tint.r, tint.g, tint.b, tint.a]));
    component.setParameter("portalIsolate", 0);
    component.setWorkBufferModifier(modifier);
  }

  get summary(): SelectionSummary {
    return { selected: this.selected, total: this.centers.length / 3, isolated: this.isolated };
  }

  async hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion): Promise<Uint8Array[]> {
    const matrix = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix).mul(this.component.entity.getWorldTransform());
    const depth = await captureDepth(app, camera, this.layers.map(id => app.scene.layers.getLayerById(id)!)), hits = new Uint8Array(this.mask.length);
    projectSelection(this.centers, hits, matrix.data, region, "set", false, depthTest(depth));
    return [hits];
  }

  async primitiveAt(app: AppBase, camera: CameraComponent, u: number, v: number) {
    this.picker ??= new SplatPicker(app, this.layers);
    const index = await this.picker.pick(camera, u, v);
    return index !== null && index < this.mask.length ? { part: 0, index } : null;
  }

  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, hits?: Uint8Array[]): SelectionSummary {
    const matrix = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix);
    matrix.mul(this.component.entity.getWorldTransform());
    this.selected = hits ? applySelection(this.mask, hits[0]!, operation, this.isolated) :
      projectSelection(this.centers, this.mask, matrix.data, region, operation, this.isolated);
    if (!this.selected) this.isolated = false;
    this.update();
    return this.summary;
  }

  clear(): SelectionSummary {
    this.mask.fill(0);
    this.selected = 0;
    this.isolated = false;
    this.update();
    return this.summary;
  }

  toggleIsolation(): SelectionSummary {
    this.isolated = this.selected > 0 && !this.isolated;
    this.update();
    return this.summary;
  }

  get layers(): readonly number[] { return this.component.layers; }
  get state(): SelectionState { return { masks: [this.mask], isolated: this.isolated }; }
  get colors(): PaintState { return this.paintState; }
  paint(color: number): SelectionSummary {
    const next = paintSelection(this.paintState, [this.mask], color);
    if (next !== this.paintState) { this.paintState = next; this.update(); }
    return this.summary;
  }
  restore(state: SelectionState, colors: PaintState = this.paintState): SelectionSummary {
    this.paintState = colors;
    this.mask.set(state.masks[0]!);
    this.selected = this.mask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
    this.isolated = state.isolated; this.update(); return this.summary;
  }
  bounds() {
    const bounds = new SelectionBounds(), transform = this.component.entity.getWorldTransform();
    for (let i = 0; i < this.mask.length; i++) if (!this.selected || this.mask[i]) bounds.add(this.centers, i * 3, transform);
    return bounds.value;
  }
  private update() {
    this.picker?.invalidate();
    (this.texture.lock() as Uint8Array).set(this.mask);
    this.texture.unlock();
    if (this.uploadedColors !== this.paintState[0]) {
      this.uploadedColors = this.paintState[0]!;
      const pixels = this.paintTexture.lock() as Uint8Array, shades = new Map<number, number[]>();
      this.uploadedColors.forEach((value, i) => {
        let rgba = shades.get(value);
        if (!rgba) {
          const color = value ? new Color().fromString(decodeColor(value)).linear() : new Color(0, 0, 0, 0);
          rgba = [color.r, color.g, color.b, value ? this.tint.a : 0].map(channel => Math.round(channel * 255));
          shades.set(value, rgba);
        }
        pixels.set(rgba, i * 4);
      });
      this.paintTexture.unlock();
    }
    this.component.setParameter("portalIsolate", this.isolated ? 1 : 0);
    this.component.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.picker?.destroy(); this.releasePicking();
    this.component.setWorkBufferModifier(null);
    for (const name of ["portalSelection", "portalSelectionTint", "portalIsolate", "portalPaint"]) this.component.deleteParameter(name);
    this.texture.destroy(); this.paintTexture.destroy();
  }
}
