import {
  Color, FILTER_NEAREST, Mat4, PIXELFORMAT_R8, Texture, WORKBUFFER_UPDATE_ONCE,
  type AppBase, type CameraComponent, type GSplatComponent
} from "playcanvas";
import type { SelectionOperation } from "./rectangle";
import { applySelection, projectSelection } from "./projectSelection";
import { captureDepth, depthTest } from "./SelectionDepth";
import type { SelectionCamera, SelectionRegion, SelectionState, SelectionSummary } from "./types";

import { SelectionBounds } from "./selectionBounds";

const modifier = {
  glsl: `
uniform sampler2D portalSelection;
uniform vec4 portalSelectionTint;
uniform float portalIsolate;
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {}
void modifySplatColor(vec3 center, inout vec4 color) {
    float selected = texelFetch(portalSelection, splat.uv, 0).r;
    color.rgb = mix(color.rgb, portalSelectionTint.rgb, selected * portalSelectionTint.a);
    color.a *= mix(1.0, selected, portalIsolate);
}`,
  wgsl: `
var portalSelection: texture_2d<f32>;
uniform portalSelectionTint: vec4f;
uniform portalIsolate: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    let selected = textureLoad(portalSelection, vec2i(splat.uv), 0).r;
    (*color) = vec4f(mix((*color).rgb, uniform.portalSelectionTint.rgb, selected * uniform.portalSelectionTint.a),
        (*color).a * mix(1.0, selected, uniform.portalIsolate));
}`
};

export class SplatSelection {
  private readonly texture: Texture;
  private readonly centers: Float32Array;
  private readonly mask: Uint8Array;
  private disposed = false;
  private selected = 0;
  private isolated = false;

  constructor(private readonly component: GSplatComponent, tint: Color) {
    const resource = component.resource;
    if (!resource?.hasCenters) throw new Error("This splat has no selectable center data.");
    this.centers = resource.centers;
    this.mask = new Uint8Array(this.centers.length / 3);
    this.texture = new Texture(resource.device, {
      name: "Portal selection", width: resource.textureDimensions.x, height: resource.textureDimensions.y,
      format: PIXELFORMAT_R8, mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST
    });
    (this.texture.lock() as Uint8Array).fill(0);
    this.texture.unlock();
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
    const depth = await captureDepth(app, camera), hits = new Uint8Array(this.mask.length);
    projectSelection(this.centers, hits, matrix.data, region, "set", false, depthTest(depth));
    return [hits];
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

  get state(): SelectionState { return { masks: [this.mask], isolated: this.isolated }; }
  restore(state: SelectionState): SelectionSummary {
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
    (this.texture.lock() as Uint8Array).set(this.mask);
    this.texture.unlock();
    this.component.setParameter("portalIsolate", this.isolated ? 1 : 0);
    this.component.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.component.setWorkBufferModifier(null);
    for (const name of ["portalSelection", "portalSelectionTint", "portalIsolate"]) this.component.deleteParameter(name);
    this.texture.destroy();
  }
}
