import { constrainMask, type SelectionScope } from "./selectionScope";
import {
  BoundingBox, Color, FILTER_NEAREST, Mat4, PIXELFORMAT_R8, PIXELFORMAT_RGBA8, Texture, Vec3, WORKBUFFER_UPDATE_ONCE,
  type AppBase, type CameraComponent, type GSplatComponent
} from "playcanvas";
import { currentSelectionArea, paintSelection, decodeColor, discardDraftSelection, recordSelectionGesture, selectionAreaAt, updateSelectionAreas, visiblePaint, visibleSelections, type PaintState } from "./selectionColors";
import type { SelectionOperation } from "./rectangle";
import { applySelection, projectSelection } from "./projectSelection";
import { captureDepth, depthTest } from "./SelectionDepth";
import type { SelectionArea, SelectionCamera, SelectionRegion, SelectionState, SelectionSummary } from "./types";

import { SplatPicker, configureSplatPicking } from "./SplatPicker";
import { SelectionBounds } from "./selectionBounds";
import { snapshotContains } from "./selectionSnapshot";
import { sectionTest } from "../section/sectionPlane";

const modifier = {
  glsl: `
uniform sampler2D portalScope;
uniform sampler2D portalSelection;
uniform sampler2D portalPaint;
uniform sampler2D portalPreview;
uniform vec4 portalSelectionTint;
uniform float portalSelectionVisible;
uniform float portalIsolate;
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {}
void modifySplatColor(vec3 center, inout vec4 color) {
    vec4 paint = texelFetch(portalPaint, splat.uv, 0);
    if (paint.a > 0.0) {
        color.rgb = mix(color.rgb, paint.rgb, paint.a);
    }
    float selected = texelFetch(portalSelection, splat.uv, 0).r;
    color.rgb = mix(color.rgb, portalSelectionTint.rgb, selected * portalSelectionTint.a * portalSelectionVisible * step(paint.a, 0.0));
    float previewed = texelFetch(portalPreview, splat.uv, 0).r;
    color.rgb = mix(color.rgb, vec3(1.0), previewed * portalSelectionTint.a);
    color.a *= mix(1.0, selected, portalIsolate) * texelFetch(portalScope, splat.uv, 0).r;
}`,
  wgsl: `
var portalScope: texture_2d<f32>;
var portalSelection: texture_2d<f32>;
var portalPaint: texture_2d<f32>;
var portalPreview: texture_2d<f32>;
uniform portalSelectionTint: vec4f;
uniform portalSelectionVisible: f32;
uniform portalIsolate: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    let paint = textureLoad(portalPaint, vec2i(splat.uv), 0);
    if (paint.a > 0.0) {
        (*color) = vec4f(mix((*color).rgb, paint.rgb, paint.a), (*color).a);
    }
    let selected = textureLoad(portalSelection, vec2i(splat.uv), 0).r;
    (*color) = vec4f(mix((*color).rgb, uniform.portalSelectionTint.rgb, selected * uniform.portalSelectionTint.a * uniform.portalSelectionVisible * step(paint.a, 0.0)),
        (*color).a * mix(1.0, selected, uniform.portalIsolate) * textureLoad(portalScope, vec2i(splat.uv), 0).r);
    let previewed = textureLoad(portalPreview, vec2i(splat.uv), 0).r;
    (*color) = vec4f(mix((*color).rgb, vec3f(1.0), previewed * uniform.portalSelectionTint.a), (*color).a);
}`
};

export class SplatSelection {
  private readonly scopeTexture: Texture;
  private scope: SelectionScope = null;
  private scopeCount: number | null = null;
  private readonly texture: Texture;
  private readonly paintTexture: Texture;
  private readonly previewTexture: Texture;
  private paintState: PaintState;
  private uploadedColors: Uint32Array;
  private readonly centers: Float32Array;
  private readonly mask: Uint8Array;
  private disposed = false;
  private picker?: SplatPicker;
  private readonly releasePicking: () => void;
  private selected = 0;
  private isolated = false;
  private selectionAreas: readonly SelectionArea[] = [];
  private currentArea: SelectionArea | null = null;
  private preview: SelectionArea | null = null;

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
    this.previewTexture = new Texture(resource.device, {
      name: "Portal selection preview", width: resource.textureDimensions.x, height: resource.textureDimensions.y,
      format: PIXELFORMAT_R8, mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST
    });
    (this.previewTexture.lock() as Uint8Array).fill(0); this.previewTexture.unlock();
    this.scopeTexture = new Texture(resource.device, {
      name: "Portal workspace", width: resource.textureDimensions.x, height: resource.textureDimensions.y,
      format: PIXELFORMAT_R8, mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST
    });
    (this.scopeTexture.lock() as Uint8Array).fill(255); this.scopeTexture.unlock();
    component.setParameter("portalScope", this.scopeTexture);
    component.setParameter("portalPaint", this.paintTexture);
    component.setParameter("portalPreview", this.previewTexture);
    component.setParameter("portalSelection", this.texture);
    component.setParameter("portalSelectionTint", new Float32Array([tint.r, tint.g, tint.b, tint.a]));
    component.setParameter("portalSelectionVisible", 1);
    component.setParameter("portalIsolate", 0);
    component.setWorkBufferModifier(modifier);
  }

  private setScope(masks: SelectionScope) {
    this.scope = masks;
    this.scopeCount = masks ? masks[0]!.reduce((n, value) => n + Number(!!value), 0) : null;
    const pixels = this.scopeTexture.lock() as Uint8Array;
    pixels.fill(masks ? 0 : 255);
    if (masks) pixels.set(masks[0]!);
    this.scopeTexture.unlock();
  }
  get summary(): SelectionSummary {
    return { selected: this.selected, total: this.scopeCount ?? this.centers.length / 3, isolated: this.isolated };
  }
  updateSection() { this.picker?.invalidate(); }

  async hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion): Promise<Uint8Array[]> {
    const matrix = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix).mul(this.component.entity.getWorldTransform());
    const depth = await captureDepth(app, camera, this.layers.map(id => app.scene.layers.getLayerById(id)!)), hits = new Uint8Array(this.mask.length);
    const visible = depthTest(depth), retained = sectionTest(app, this.centers, this.component.entity.getWorldTransform());
    projectSelection(this.centers, hits, matrix.data, region, "set", false,
      (id, u, v, w, z) => (!retained || retained(id)) && visible(id, u, v, w, z));
    constrainMask(hits, this.scope?.[0]);
    return [hits];
  }

  async primitiveAt(app: AppBase, camera: CameraComponent, u: number, v: number) {
    this.picker ??= new SplatPicker(app, this.layers);
    const index = await this.picker.pick(camera, u, v);
    return index !== null && index < this.mask.length && (!this.scope || this.scope[0]![index]) ? { part: 0, index } : null;
  }

  // On CPU-sorted splats the engine's Picker cannot supply a depth pixel.
  // Use the resource's already-resident centers for an on-demand ray query;
  // this allocates no index, GPU buffer, or work during ordinary rendering.
  pickRay(origin: Vec3, direction: Vec3): Vec3 | null { return this.surfaceHit(origin, direction)?.point ?? null; }
  surfaceHit(origin: Vec3, direction: Vec3) {
    const transform = this.component.entity.getWorldTransform();
    const inverse = new Mat4().invert(transform);
    const start = inverse.transformPoint(origin, new Vec3());
    const forward = inverse.transformVector(direction, new Vec3()).normalize();
    const retained = sectionTest(this.component.system.app, this.centers, transform);
    const size = this.component.resource!.aabb.halfExtents.length() * 2;
    const margin = Math.max(1e-5, size / Math.sqrt(this.mask.length));
    let best = Infinity, candidate = -1;
    for (let index = 0; index < this.mask.length; index++) {
      if ((this.scope && !this.scope[0]![index]) || (this.isolated && !this.mask[index]) || (retained && !retained(index))) continue;
      const offset = index * 3;
      const x = this.centers[offset]! - start.x, y = this.centers[offset + 1]! - start.y, z = this.centers[offset + 2]! - start.z;
      const depth = x * forward.x + y * forward.y + z * forward.z;
      if (depth <= 0 || depth >= best) continue;
      const radialSq = x * x + y * y + z * z - depth * depth;
      const radius = margin + depth * .035; // 2° controller-pointing cone
      if (radialSq <= radius * radius) { best = depth; candidate = offset; }
    }
    return candidate < 0 ? null : { part: 0, index: candidate / 3, point: transform.transformPoint(new Vec3(
      this.centers[candidate]!, this.centers[candidate + 1]!, this.centers[candidate + 2]!), new Vec3()) };
  }

  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, hits?: Uint8Array[]): SelectionSummary {
    const matrix = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix);
    matrix.mul(this.component.entity.getWorldTransform());
    const previous = operation === "add" ? [this.mask.slice()] : undefined;
    this.selected = hits ? applySelection(this.mask, hits[0]!, operation, this.isolated) :
      projectSelection(this.centers, this.mask, matrix.data, region, operation, this.isolated,
        sectionTest(this.component.system.app, this.centers, this.component.entity.getWorldTransform()));
    if (this.scope) this.selected = constrainMask(this.mask, this.scope[0]);
    if (!this.selected) this.isolated = false;
    this.selectionAreas = recordSelectionGesture(this.selectionAreas, this.state, operation, previous);
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas);
    this.update();
    return this.summary;
  }

  clear(): SelectionSummary {
    const saved = discardDraftSelection(this.paintState, this.selectionAreas);
    this.paintState = saved.colors;
    this.selectionAreas = saved.areas;
    this.mask.fill(0);
    this.selected = 0;
    this.isolated = false;
    this.currentArea = null;
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
  get areas(): readonly SelectionArea[] { return this.selectionAreas; }
  areaAt(part: number, index: number): SelectionArea | null {
    return selectionAreaAt(this.selectionAreas.filter(area => area.visible), part, index) ??
      (this.currentArea && snapshotContains(this.currentArea.snapshot, part, index) ? this.currentArea : null);
  }
  previewArea(area: SelectionArea | null) {
    if (this.preview?.snapshot === area?.snapshot) return;
    this.preview = area;
    const pixels = this.previewTexture.lock() as Uint8Array;
    pixels.fill(0);
    const mask = area?.snapshot.masks[0];
    if (mask) for (let index = 0; index < mask.length; index++) {
      if ((!this.scope || this.scope[0]![index]) && (mask.bits[index >> 3]! & (1 << (index & 7)))) pixels[index] = 255;
    }
    this.previewTexture.unlock();
    this.component.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
  }
  renameArea(id: number, name: string): SelectionSummary {
    const value = name.trim();
    if (value && this.selectionAreas.find(area => area.id === id)?.name !== value) {
      this.selectionAreas = this.selectionAreas.map(area => area.id === id ? { ...area, name: value } : area);
    }
    return this.summary;
  }
  setAreaVisible(id: number, visible: boolean): SelectionSummary {
    if (this.selectionAreas.find(area => area.id === id)?.visible === visible) return this.summary;
    this.selectionAreas = this.selectionAreas.map(area => area.id === id ? { ...area, visible } : area);
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas); this.update(); return this.summary;
  }
  paint(color: number, replaceColor = this.currentArea?.color ?? 0): SelectionSummary {
    const areas = updateSelectionAreas(this.selectionAreas, this.paintState, [this.mask], color);
    const next = paintSelection(this.paintState, [this.mask], color, replaceColor);
    if (next !== this.paintState) {
      this.paintState = next; this.selectionAreas = areas;
      this.currentArea = currentSelectionArea(this.state, areas); this.update();
    }
    return this.summary;
  }
  restore(state: SelectionState, colors: PaintState = this.paintState, areas: readonly SelectionArea[] = this.selectionAreas, scope: SelectionScope = this.scope): SelectionSummary {
    if (scope !== this.scope) this.setScope(scope);
    this.paintState = colors; this.selectionAreas = areas;
    this.mask.set(state.masks[0]!);
    this.selected = constrainMask(this.mask, this.scope?.[0]);
    this.isolated = state.isolated;
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas);
    this.update(); return this.summary;
  }
  bounds(state: SelectionState | null = this.state) {
    if ((state === null || !state.masks.some(mask => mask.some(Boolean))) && this.scope) state = { masks: [...this.scope], isolated: false };
    const bounds = new SelectionBounds(), transform = this.component.entity.getWorldTransform();
    const mask = state === null ? null : state.masks[0]!, selected = mask !== null && mask.some(Boolean);
    if (!selected) {
      const whole = new BoundingBox(); whole.setFromTransformedAabb(this.component.resource!.aabb, transform);
      return whole;
    }
    for (let i = 0; i < this.mask.length; i++) if (!selected || mask![i]) bounds.add(this.centers, i * 3, transform);
    return bounds.value;
  }
  private update() {
    this.picker?.invalidate();
    const selection = this.texture.lock() as Uint8Array;
    selection.set(this.isolated ? this.mask : visibleSelections(this.selectionAreas, [this.mask.length])[0]!);
    this.texture.unlock();
    const displayColors = visiblePaint(this.paintState, this.selectionAreas)[0]!;
    if (this.uploadedColors !== displayColors) {
      const pixels = this.paintTexture.lock() as Uint8Array, shades = new Map<number, number[]>();
      displayColors.forEach((value, i) => {
        if (value === this.uploadedColors[i]) return;
        let rgba = shades.get(value);
        if (!rgba) {
          const color = value ? new Color().fromString(decodeColor(value)).linear() : new Color(0, 0, 0, 0);
          rgba = [color.r, color.g, color.b, value ? this.tint.a : 0].map(channel => Math.round(channel * 255));
          shades.set(value, rgba);
        }
        const offset = i * 4;
        pixels[offset] = rgba[0]!; pixels[offset + 1] = rgba[1]!;
        pixels[offset + 2] = rgba[2]!; pixels[offset + 3] = rgba[3]!;
      });
      this.paintTexture.unlock();
      this.uploadedColors = displayColors;
    }
    this.component.setParameter("portalIsolate", this.isolated ? 1 : 0);
    this.component.setParameter("portalSelectionVisible", !this.isolated || (this.currentArea?.visible && !this.currentArea.color) ? 1 : 0);
    this.component.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.picker?.destroy(); this.releasePicking();
    this.component.setWorkBufferModifier(null);
    for (const name of ["portalScope", "portalSelection", "portalSelectionTint", "portalSelectionVisible", "portalIsolate", "portalPaint", "portalPreview"]) this.component.deleteParameter(name);
    this.scopeTexture.destroy(); this.texture.destroy(); this.paintTexture.destroy(); this.previewTexture.destroy();
  }
}
