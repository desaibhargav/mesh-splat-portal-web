import {
  Color, Entity, Mat4, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, StandardMaterial,
  TYPE_INT8, TYPE_INT16, TYPE_UINT8, TYPE_UINT16, VertexBuffer,
  type AppBase, type CameraComponent, type GraphicsDevice, type RenderComponent
} from "playcanvas";
import { applySelection, projectSelection } from "./projectSelection";
import type { SelectionOperation } from "./rectangle";
import { MeshPicker } from "./MeshPicker";
import { SelectionBounds } from "./selectionBounds";
import type { SelectionCamera, SelectionRegion, SelectionState, SelectionSummary } from "./types";

interface Part {
  source: MeshInstance; positions: Float32Array; indices: number[]; centers: Float32Array; mask: Uint8Array;
  selected: MeshInstance; rest: MeshInstance; material: StandardMaterial;
}

export function triangleCenters(positions: ArrayLike<number>, indices: number[], scale = 1, signed = false): Float32Array {
  const centers = new Float32Array(indices.length);
  for (let face = 0; face < indices.length / 3; face++) {
    for (let axis = 0; axis < 3; axis++) {
      let sum = 0;
      for (let corner = 0; corner < 3; corner++) {
        const value = positions[indices[face * 3 + corner]! * 3 + axis]! / scale;
        sum += signed ? Math.max(-1, value) : value;
      }
      centers[face * 3 + axis] = sum / 3;
    }
  }
  return centers;
}

function copyMesh(device: GraphicsDevice, source: Mesh): Mesh {
  const mesh = new Mesh(device);
  const buffer = source.vertexBuffer;
  mesh.vertexBuffer = new VertexBuffer(device, buffer.format, buffer.numVertices, { data: buffer.storage.slice(0) });
  mesh.aabb.copy(source.aabb);
  return mesh;
}

export class MeshSelection {
  private readonly display = new Entity("Selection display");
  private readonly originals: { component: RenderComponent; enabled: boolean }[];
  private readonly parts: Part[] = [];
  private selected = 0;
  private isolated = false;
  private disposed = false;
  private picker?: MeshPicker;

  constructor(entity: Entity, device: GraphicsDevice, tint: Color) {
    const components = entity.findComponents("render") as RenderComponent[];
    const instances = components.filter(c => c.enabled && c.entity.enabled).flatMap(c => c.meshInstances).filter(instance => instance.visible);
    // Validate before changing any scene state.
    for (const instance of instances) {
      if (instance.skinInstance || instance.morphInstance || instance.mesh.primitive[0]!.type !== PRIMITIVE_TRIANGLES || !(instance.material instanceof StandardMaterial)) {
        throw new Error("Selection requires static triangle meshes with standard materials.");
      }
    }
    this.originals = components.map(component => ({ component, enabled: component.enabled }));
    try {
      for (const source of instances) {
        const mesh = source.mesh;
        const positions: number[] = [], allIndices: number[] = [];
        mesh.getPositions(positions); mesh.getIndices(allIndices);
        const primitive = mesh.primitive[0]!;
        const indices = primitive.indexed ? allIndices.slice(primitive.base, primitive.base + primitive.count) :
          Array.from({ length: primitive.count }, (_, i) => primitive.base + i);
        const element = mesh.vertexBuffer.format.elements.find(e => e.name === SEMANTIC_POSITION)!;
        const scales: Record<number, number> = { [TYPE_INT8]: 127, [TYPE_UINT8]: 255, [TYPE_INT16]: 32767, [TYPE_UINT16]: 65535 };
        const scale = element.normalize ? scales[element.dataType]! : 1;
        const signed = element.normalize && (element.dataType === TYPE_INT8 || element.dataType === TYPE_INT16);
        const decoded = Float32Array.from(positions, value => signed ? Math.max(-1, value / scale) : value / scale);
        const centers = triangleCenters(decoded, indices);
        const material = (source.material as StandardMaterial).clone();
        material.emissive.copy(tint); material.emissiveIntensity = tint.a;
        material.update();
        const selected = new MeshInstance(copyMesh(device, mesh), material, source.node);
        const rest = new MeshInstance(copyMesh(device, mesh), source.material, source.node);
        selected.castShadow = rest.castShadow = false;
        this.parts.push({ source, positions: decoded, indices, centers, mask: new Uint8Array(indices.length / 3), selected, rest, material });
      }
      this.refresh();
      this.display.addComponent("render", { meshInstances: this.parts.flatMap(p => [p.rest, p.selected]) });
      entity.addChild(this.display);
      for (const { component } of this.originals) component.enabled = false;
    } catch (error) { this.destroy(); throw error; }
  }

  get layers(): readonly number[] { return this.display.render!.layers; }
  get summary(): SelectionSummary {
    return { selected: this.selected, total: this.parts.reduce((sum, p) => sum + p.mask.length, 0), isolated: this.isolated };
  }
  async hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion): Promise<Uint8Array[]> {
    this.picker ??= new MeshPicker(app, this.parts);
    return this.picker.capture(camera, region, this.isolated);
  }
  get state(): SelectionState { return { masks: this.parts.map(part => part.mask), isolated: this.isolated }; }
  restore(state: SelectionState): SelectionSummary {
    this.selected = 0;
    this.parts.forEach((part, i) => {
      part.mask.set(state.masks[i]!);
      this.selected += part.mask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
    });
    this.isolated = state.isolated; this.refresh(); return this.summary;
  }
  bounds() {
    const bounds = new SelectionBounds();
    for (const part of this.parts) {
      const transform = part.source.node.getWorldTransform();
      for (let face = 0; face < part.mask.length; face++) if (!this.selected || part.mask[face]) {
        for (let corner = 0; corner < 3; corner++) bounds.add(part.positions, part.indices[face * 3 + corner]! * 3, transform);
      }
    }
    return bounds.value;
  }
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, hits?: Uint8Array[]): SelectionSummary {
    const viewProjection = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix);
    this.selected = 0;
    for (const [i, part] of this.parts.entries()) {
      const matrix = new Mat4().mul2(viewProjection, part.source.node.getWorldTransform());
      this.selected += hits ? applySelection(part.mask, hits[i]!, operation, this.isolated) :
        projectSelection(part.centers, part.mask, matrix.data, region, operation, this.isolated);
    }
    if (!this.selected) this.isolated = false;
    this.refresh();
    return this.summary;
  }
  clear(): SelectionSummary {
    for (const part of this.parts) part.mask.fill(0);
    this.selected = 0; this.isolated = false; this.refresh(); return this.summary;
  }
  toggleIsolation(): SelectionSummary {
    this.isolated = this.selected > 0 && !this.isolated;
    this.refresh(); return this.summary;
  }
  private refresh() {
    for (const part of this.parts) {
      const selected: number[] = [], rest: number[] = [];
      for (let i = 0; i < part.mask.length; i++) {
        const subset = part.mask[i] ? selected : rest;
        subset.push(part.indices[i * 3]!, part.indices[i * 3 + 1]!, part.indices[i * 3 + 2]!);
      }
      for (const [instance, indices] of [[part.selected, selected], [part.rest, rest]] as const) {
        instance.visible = indices.length > 0 && (instance === part.selected || !this.isolated);
        if (indices.length) { instance.mesh.setIndices(indices); instance.mesh.update(PRIMITIVE_TRIANGLES, false); }
      }
    }
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.picker?.destroy();
    this.display.destroy();
    for (const part of this.parts) {
      // Safe even if RenderComponent already destroyed the instances.
      part.selected.destroy(); part.rest.destroy(); part.material.destroy();
    }
    for (const { component, enabled } of this.originals) component.enabled = enabled;
  }
}
