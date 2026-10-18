import {
  Color, FILTER_NEAREST, Mat4, PIXELFORMAT_R8, Texture, WORKBUFFER_UPDATE_ONCE,
  type GSplatComponent
} from "playcanvas";
import type { SelectionOperation } from "./rectangle";
import { projectSelection } from "./projectSelection";
import type { DepthImage } from "./SelectionDepth";
import type { SelectionCamera, SelectionRegion, SelectionSummary } from "./types";

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
  private selected = 0;
  private isolated = false;

  constructor(private readonly component: GSplatComponent, tint: Color) {
    const resource = component.resource;
    if (!resource?.hasCenters) throw new Error("This splat has no selectable center data.");
    this.centers = resource.centers;
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

  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, depth?: DepthImage): SelectionSummary {
    const matrix = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix);
    matrix.mul(this.component.entity.getWorldTransform());
    const mask = this.texture.lock() as Uint8Array;
    this.selected = projectSelection(this.centers, mask, matrix.data, region, operation, this.isolated, depth);
    this.texture.unlock();
    if (!this.selected) this.isolated = false;
    this.update();
    return this.summary;
  }

  clear(): SelectionSummary {
    (this.texture.lock() as Uint8Array).fill(0);
    this.texture.unlock();
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

  private update() {
    this.component.setParameter("portalIsolate", this.isolated ? 1 : 0);
    this.component.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
  }

  destroy() {
    this.component.setWorkBufferModifier(null);
    for (const name of ["portalSelection", "portalSelectionTint", "portalIsolate"]) this.component.deleteParameter(name);
    this.texture.destroy();
  }
}
