import {
  Color, Entity, Mat4, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, StandardMaterial,
  TYPE_INT8, TYPE_INT16, TYPE_UINT8, TYPE_UINT16, VertexBuffer,
  type AppBase, type CameraComponent, type Layer, type RenderComponent
} from "playcanvas";
import { currentSelectionArea, paintSelection, decodeColor, recordSelectionArea, selectionAreaAt, updateSelectionAreas, visiblePaint, visibleSelections, type PaintState } from "./selectionColors";
import { applySelection, projectSelection } from "./projectSelection";
import type { SelectionOperation } from "./rectangle";
import { MeshPicker } from "./MeshPicker";
import { SelectionBounds } from "./selectionBounds";
import { snapshotContains } from "./selectionSnapshot";
import type { SelectionArea, SelectionCamera, SelectionRegion, SelectionState, SelectionSummary } from "./types";

interface Part {
  source: MeshInstance; positions: Float32Array; indices: number[]; centers: Float32Array; mask: Uint8Array;
  vertices: VertexBuffer; baseMaterial: StandardMaterial; layers: Layer[]; groups: Map<number, { instance: MeshInstance; material: StandardMaterial }>;
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

// Subsets own their index buffers and borrow one vertex buffer per source part.
class SubsetMesh extends Mesh {
  constructor(source: Mesh, vertices: VertexBuffer) {
    super(vertices.device); this.vertexBuffer = vertices; this.aabb.copy(source.aabb);
  }
  destroy() { this.vertexBuffer = null!; super.destroy(); }
}

export class MeshSelection {
  private readonly originals: { component: RenderComponent; enabled: boolean }[];
  private readonly parts: Part[] = [];
  private selected = 0;
  private isolated = false;
  private disposed = false;
  private picker?: MeshPicker;
  private paintState: PaintState = [];
  private selectionAreas: readonly SelectionArea[] = [];
  private currentArea: SelectionArea | null = null;
  private preview: SelectionArea | null = null;

  constructor(entity: Entity, app: AppBase, private readonly tint: Color) {
    const device = app.graphicsDevice;
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
        const buffer = mesh.vertexBuffer;
        const vertices = new VertexBuffer(device, buffer.format, buffer.numVertices, { data: buffer.storage.slice(0) });
        this.parts.push({ source, positions: decoded, indices, centers, mask: new Uint8Array(indices.length / 3), vertices, baseMaterial: source.material as StandardMaterial, layers: components.find(component => component.meshInstances.includes(source))!.layers.map(id => app.scene.layers.getLayerById(id)!), groups: new Map() });
      }
      this.paintState = this.parts.map(part => new Uint32Array(part.mask.length));
      this.refresh();
      for (const { component } of this.originals) component.enabled = false;
    } catch (error) { this.destroy(); throw error; }
  }

  get layers(): readonly number[] { return [...new Set(this.parts.flatMap(part => part.layers.map(layer => layer.id)))]; }
  get summary(): SelectionSummary {
    return { selected: this.selected, total: this.parts.reduce((sum, p) => sum + p.mask.length, 0), isolated: this.isolated };
  }
  async hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion): Promise<Uint8Array[]> {
    this.picker ??= new MeshPicker(app, this.parts);
    return this.picker.capture(camera, region, this.isolated);
  }
  async primitiveAt(app: AppBase, camera: CameraComponent, u: number, v: number) {
    this.picker ??= new MeshPicker(app, this.parts);
    return this.picker.primitiveAt(camera, u, v, this.isolated);
  }
  get state(): SelectionState { return { masks: this.parts.map(part => part.mask), isolated: this.isolated }; }
  get colors(): PaintState { return this.paintState; }
  get areas(): readonly SelectionArea[] { return this.selectionAreas; }
  areaAt(part: number, index: number): SelectionArea | null {
    return selectionAreaAt(this.selectionAreas.filter(area => area.visible), part, index) ??
      (this.currentArea && snapshotContains(this.currentArea.snapshot, part, index) ? this.currentArea : null);
  }
  previewArea(area: SelectionArea | null) {
    if (this.preview?.id === area?.id) return;
    this.preview = area; this.refresh();
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
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas); this.refresh(); return this.summary;
  }
  paint(color: number): SelectionSummary {
    const areas = updateSelectionAreas(this.selectionAreas, this.paintState, this.state.masks, color);
    const next = paintSelection(this.paintState, this.state.masks, color, this.currentArea?.color);
    if (next !== this.paintState) {
      this.paintState = next; this.selectionAreas = areas;
      this.currentArea = currentSelectionArea(this.state, areas); this.refresh();
    }
    return this.summary;
  }
  restore(state: SelectionState, colors: PaintState = this.paintState, areas: readonly SelectionArea[] = this.selectionAreas): SelectionSummary {
    this.paintState = colors; this.selectionAreas = areas;
    this.selected = 0;
    this.parts.forEach((part, i) => {
      part.mask.set(state.masks[i]!);
      this.selected += part.mask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
    });
    this.isolated = state.isolated;
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas);
    this.refresh(); return this.summary;
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
    this.selectionAreas = recordSelectionArea(this.selectionAreas, this.state);
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas);
    this.refresh();
    return this.summary;
  }
  clear(): SelectionSummary {
    if (this.currentArea && !this.currentArea.color) {
      this.selectionAreas = this.selectionAreas.map(area => area.id === this.currentArea!.id ? { ...area, visible: false } : area);
    }
    for (const part of this.parts) part.mask.fill(0);
    this.selected = 0; this.isolated = false; this.currentArea = null; this.refresh(); return this.summary;
  }
  toggleIsolation(): SelectionSummary {
    this.isolated = this.selected > 0 && !this.isolated;
    this.refresh(); return this.summary;
  }
  private refresh() {
    this.picker?.invalidate();
    const displayColors = visiblePaint(this.paintState, this.selectionAreas);
    const displaySelections = visibleSelections(this.selectionAreas, this.parts.map(part => part.mask.length));
    const preview = this.preview?.snapshot.masks ?? [];
    for (const [partIndex, part] of this.parts.entries()) {
      const subsets = new Map<number, number[]>(), colors = displayColors[partIndex]!;
      for (let face = 0; face < part.mask.length; face++) {
        if (this.isolated && !part.mask[face]) continue;
        const highlighted = !!displaySelections[partIndex]![face];
        const previewMask = preview[partIndex];
        const previewed = !!previewMask && !!(previewMask.bits[face >> 3]! & (1 << (face & 7)));
        const key = (colors[face]! << 2) | Number(highlighted) | (previewed ? 2 : 0);
        let indices = subsets.get(key);
        if (!indices) { indices = []; subsets.set(key, indices); }
        indices.push(part.indices[face * 3]!, part.indices[face * 3 + 1]!, part.indices[face * 3 + 2]!);
      }
      for (const [key, { instance, material }] of part.groups) if (!subsets.has(key)) {
        part.layers.forEach(layer => layer.removeMeshInstances([instance]));
        instance.destroy();
        if (material !== part.baseMaterial) material.destroy();
        part.groups.delete(key);
      }
      for (const [key, indices] of subsets) {
        let group = part.groups.get(key);
        if (!group) {
          const color = key >> 2, selected = !!(key & 1), previewed = !!(key & 2);
          let material = part.baseMaterial;
          if (color || selected || previewed) {
            material = material.clone();
            const shade = color ? new Color().fromString(decodeColor(color)).linear() : this.tint;
            if (color) material.diffuse.lerp(material.diffuse, shade, this.tint.a);
            if (selected && !color) { material.emissive.copy(shade); material.emissiveIntensity = this.tint.a; }
            if (previewed) { material.emissive.copy(Color.WHITE); material.emissiveIntensity = 1; }
            material.update();
          }
          const instance = new MeshInstance(new SubsetMesh(part.source.mesh, part.vertices), material, part.source.node);
          instance.castShadow = false; group = { instance, material }; part.groups.set(key, group);
          part.layers.forEach(layer => layer.addMeshInstances([instance]));
        }
        group.instance.mesh.setIndices(indices); group.instance.mesh.update(PRIMITIVE_TRIANGLES, false);
      }
    }
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.picker?.destroy();
    for (const part of this.parts) {
      for (const { instance, material } of part.groups.values()) {
        part.layers.forEach(layer => layer.removeMeshInstances([instance]));
        instance.destroy();
        if (material !== part.baseMaterial) material.destroy();
      }
      part.vertices.destroy();
    }
    for (const { component, enabled } of this.originals) component.enabled = enabled;
  }
}
