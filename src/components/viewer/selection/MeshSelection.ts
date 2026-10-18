import {
  Color, Entity, Mat4, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, StandardMaterial,
  TYPE_INT8, TYPE_INT16, TYPE_UINT8, TYPE_UINT16, VertexBuffer,
  type GraphicsDevice, type RenderComponent
} from "playcanvas";
import { projectSelection } from "./projectSelection";
import type { SelectionOperation } from "./rectangle";
import type { DepthImage } from "./SelectionDepth";
import type { SelectionCamera, SelectionRegion, SelectionSummary } from "./types";

interface Part {
  source: MeshInstance; indices: number[]; centers: Float32Array; mask: Uint8Array;
  selected: MeshInstance; rest: MeshInstance; material: StandardMaterial;
}

export function triangleCenters(positions: number[], indices: number[], scale = 1, signed = false): Float32Array {
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
        const centers = triangleCenters(positions, indices, element.normalize ? scales[element.dataType] : 1,
          element.normalize && (element.dataType === TYPE_INT8 || element.dataType === TYPE_INT16));
        const material = (source.material as StandardMaterial).clone();
        material.emissive.copy(tint); material.emissiveIntensity = tint.a;
        material.update();
        const selected = new MeshInstance(copyMesh(device, mesh), material, source.node);
        const rest = new MeshInstance(copyMesh(device, mesh), source.material, source.node);
        selected.castShadow = rest.castShadow = false;
        this.parts.push({ source, indices, centers, mask: new Uint8Array(indices.length / 3), selected, rest, material });
      }
      this.refresh();
      this.display.addComponent("render", { meshInstances: this.parts.flatMap(p => [p.rest, p.selected]) });
      entity.addChild(this.display);
      for (const { component } of this.originals) component.enabled = false;
    } catch (error) { this.destroy(); throw error; }
  }

  get summary(): SelectionSummary {
    return { selected: this.selected, total: this.parts.reduce((sum, p) => sum + p.mask.length, 0), isolated: this.isolated };
  }
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, depth?: DepthImage): SelectionSummary {
    const viewProjection = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix);
    this.selected = 0;
    for (const part of this.parts) {
      const matrix = new Mat4().mul2(viewProjection, part.source.node.getWorldTransform());
      this.selected += projectSelection(part.centers, part.mask, matrix.data, region, operation, this.isolated, depth);
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
    this.display.destroy();
    for (const part of this.parts) {
      // Safe even if RenderComponent already destroyed the instances.
      part.selected.destroy(); part.rest.destroy(); part.material.destroy();
    }
    for (const { component, enabled } of this.originals) component.enabled = enabled;
  }
}
