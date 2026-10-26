import { constrainMask, type SelectionScope } from "./selectionScope";
import {
  BLEND_NORMAL, CULLFACE_NONE, Color, Entity, Mat4, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, StandardMaterial,
  TYPE_INT8, TYPE_INT16, TYPE_UINT8, TYPE_UINT16, Vec3, type VertexBuffer,
  type AppBase, type CameraComponent, type Layer, type RenderComponent
} from "playcanvas";
import { currentSelectionArea, paintSelection, decodeColor, discardDraftSelection, recordSelectionGesture, selectionAreaAt, selectionHoverOpacity, updateSelectionAreas, visiblePaint, visibleSelections, type PaintState } from "./selectionColors";
import { applySelection, projectSelection } from "./projectSelection";
import type { SelectionOperation } from "./rectangle";
import { MeshPicker } from "./MeshPicker";
import { MeshVisibility } from "./visibility/MeshVisibility";
import { SelectionBounds } from "./selectionBounds";
import { snapshotContains } from "./selectionSnapshot";
import { configureSectionMaterial, reverseFaceColor } from "../section/sectionShaders";
import { sectionTest, setSectionPlane } from "../section/sectionPlane";
import type { SelectionArea, SelectionCamera, SelectionRegion, SelectionSnapshot, SelectionState, SelectionSummary } from "./types";

interface Part {
  source: MeshInstance; positions: Float32Array; indices: number[]; centers: Float32Array; mask: Uint8Array;
  scope: Uint8Array | null; vertices: VertexBuffer; baseMaterial: StandardMaterial; layers: Layer[]; groups: Map<number, { instance: MeshInstance; material: StandardMaterial }>;
  previewMaterial?: StandardMaterial;
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
  private scope: SelectionScope = null;
  private scopeCount: number | null = null;
  private selected = 0;
  private isolated = false;
  private disposed = false;
  private sectionEnabled = false;
  private picker?: MeshPicker;
  private visibility?: MeshVisibility;
  private paintState: PaintState = [];
  private selectionAreas: readonly SelectionArea[] = [];
  private currentArea: SelectionArea | null = null;
  private preview: SelectionArea | null = null;
  private readonly previews = new Map<SelectionSnapshot, { part: Part; instance: MeshInstance }[]>();

  constructor(entity: Entity, private readonly app: AppBase, private readonly tint: Color) {
    setSectionPlane(app, null);
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
        const vertices = buffer; // Subset meshes share read-only source vertices.
        const baseMaterial = (source.material as StandardMaterial).clone();
        configureSectionMaterial(baseMaterial); baseMaterial.update();
        this.parts.push({ scope: null, source, positions: decoded, indices, centers, mask: new Uint8Array(indices.length / 3), vertices, baseMaterial, layers: components.find(component => component.meshInstances.includes(source))!.layers.map(id => app.scene.layers.getLayerById(id)!), groups: new Map() });
      }
      this.paintState = this.parts.map(part => new Uint32Array(part.mask.length));
      this.refresh();
      for (const { component } of this.originals) component.enabled = false;
    } catch (error) { this.destroy(); throw error; }
  }

  private setScope(masks: SelectionScope) {
    this.scope = masks;
    this.scopeCount = masks ? masks.reduce((n, mask) => n + mask.reduce((n, value) => n + Number(!!value), 0), 0) : null;
    this.parts.forEach((part, index) => { part.scope = masks?.[index] ?? null; });
  }
  get layers(): readonly number[] { return [...new Set(this.parts.flatMap(part => part.layers.map(layer => layer.id)))]; }
  updateSection() {
    const enabled = !!this.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue();
    if (enabled !== this.sectionEnabled) {
      this.sectionEnabled = enabled;
      for (const part of this.parts) {
        const original = part.source.material as StandardMaterial;
        const materials = new Set([part.baseMaterial, ...Array.from(part.groups.values(), group => group.material)]);
        if (part.previewMaterial) materials.add(part.previewMaterial);
        for (const material of materials) {
          material.cull = enabled ? CULLFACE_NONE : original.cull;
          material.twoSidedLighting = enabled || original.twoSidedLighting;
          material.update();
        }
      }
    }
    this.picker?.invalidate();
  }
  get summary(): SelectionSummary {
    return { selected: this.selected, total: this.scopeCount ?? this.parts.reduce((sum, p) => sum + p.mask.length, 0), isolated: this.isolated };
  }
  async hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion): Promise<Uint8Array[]> {
    this.picker ??= new MeshPicker(app, this.parts);
    this.visibility ??= new MeshVisibility(app, this.parts);
    const snapshot = this.visibility.snapshot(camera, region, this.isolated);
    return this.visibility.complete(snapshot, await this.picker.captureImage(camera, region, this.isolated));
  }
  async primitiveAt(app: AppBase, camera: CameraComponent, u: number, v: number) {
    this.picker ??= new MeshPicker(app, this.parts);
    return this.picker.primitiveAt(camera, u, v, this.isolated);
  }
  surfaceHit(origin: Vec3, direction: Vec3) {
    this.visibility ??= new MeshVisibility(this.app, this.parts);
    return this.visibility.surfaceHit(origin, direction, this.isolated);
  }
  pickRay(origin: Vec3, direction: Vec3) {
    this.visibility ??= new MeshVisibility(this.app, this.parts);
    return this.visibility.raycast(origin, direction, this.isolated);
  }
  get state(): SelectionState { return { masks: this.parts.map(part => part.mask), isolated: this.isolated }; }
  get colors(): PaintState { return this.paintState; }
  get areas(): readonly SelectionArea[] { return this.selectionAreas; }
  areaAt(part: number, index: number): SelectionArea | null {
    return selectionAreaAt(this.selectionAreas.filter(area => area.visible), part, index) ??
      (this.currentArea && snapshotContains(this.currentArea.snapshot, part, index) ? this.currentArea : null);
  }
  previewArea(area: SelectionArea | null) {
    if (this.preview?.snapshot === area?.snapshot) return;
    if (this.preview) for (const { instance } of this.previews.get(this.preview.snapshot) ?? []) instance.visible = false;
    this.preview = area;
    if (!area) return;
    let groups = this.previews.get(area.snapshot);
    if (!groups) {
      groups = this.parts.flatMap((part, partIndex) => {
        const mask = area.snapshot.masks[partIndex]!, indices: number[] = [];
        mask.bits.forEach((byte, offset) => {
          if (!byte) return;
          for (let bit = 0; bit < 8; bit++) {
            const face = offset * 8 + bit;
            if (face < mask.length && (byte & (1 << bit)) && (!part.scope || part.scope[face]) && (!this.isolated || part.mask[face])) {
              indices.push(part.indices[face * 3]!, part.indices[face * 3 + 1]!, part.indices[face * 3 + 2]!);
            }
          }
        });
        if (!indices.length) return [];
        if (!part.previewMaterial) {
          part.previewMaterial = new StandardMaterial();
          configureSectionMaterial(part.previewMaterial, false);
          part.previewMaterial.useLighting = false;
          part.previewMaterial.cull = part.baseMaterial.cull;
          part.previewMaterial.blendType = BLEND_NORMAL;
          part.previewMaterial.opacity = selectionHoverOpacity;
          part.previewMaterial.emissive.copy(Color.WHITE);
          part.previewMaterial.emissiveIntensity = 1;
          part.previewMaterial.depthWrite = false;
          part.previewMaterial.depthBias = -1;
          part.previewMaterial.slopeDepthBias = -1;
          part.previewMaterial.update();
        }
        const mesh = new SubsetMesh(part.source.mesh, part.vertices);
        mesh.setIndices(indices); mesh.update(PRIMITIVE_TRIANGLES, false);
        const instance = new MeshInstance(mesh, part.previewMaterial, part.source.node);
        instance.castShadow = false;
        part.layers.forEach(layer => layer.addMeshInstances([instance]));
        return [{ part, instance }];
      });
      this.previews.set(area.snapshot, groups);
    }
    for (const { instance } of groups) instance.visible = true;
  }
  private clearPreviews() {
    for (const groups of this.previews.values()) for (const { part, instance } of groups) {
      part.layers.forEach(layer => layer.removeMeshInstances([instance])); instance.destroy();
    }
    this.previews.clear(); this.preview = null;
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
  paint(color: number, workspaceColor = 0): SelectionSummary {
    const replaceColor = this.currentArea?.color || workspaceColor;
    const areas = updateSelectionAreas(this.selectionAreas, this.paintState, this.state.masks, color);
    const next = paintSelection(this.paintState, this.state.masks, color, replaceColor);
    if (next !== this.paintState) {
      this.paintState = next; this.selectionAreas = areas;
      this.currentArea = currentSelectionArea(this.state, areas); this.refresh();
    }
    return this.summary;
  }
  restore(state: SelectionState, colors: PaintState = this.paintState, areas: readonly SelectionArea[] = this.selectionAreas, scope: SelectionScope = this.scope): SelectionSummary {
    if (scope !== this.scope) this.setScope(scope);
    this.paintState = colors; this.selectionAreas = areas;
    this.selected = 0;
    this.parts.forEach((part, i) => {
      part.mask.set(state.masks[i]!);
      this.selected += constrainMask(part.mask, part.scope ?? undefined);
    });
    this.isolated = state.isolated;
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas);
    this.refresh(); return this.summary;
  }
  bounds(state: SelectionState | null = this.state) {
    const bounds = new SelectionBounds();
    if ((state === null || !state.masks.some(mask => mask.some(Boolean))) && this.scope) state = { masks: [...this.scope], isolated: false };
    const selected = state !== null && state.masks.some(mask => mask.some(Boolean));
    if (!selected) {
      const whole = this.parts[0]?.source.aabb.clone();
      if (!whole) return null;
      for (let i = 1; i < this.parts.length; i++) whole.add(this.parts[i]!.source.aabb);
      return whole;
    }
    for (const [partIndex, part] of this.parts.entries()) {
      const transform = part.source.node.getWorldTransform();
      const mask = state?.masks[partIndex];
      for (let face = 0; face < part.mask.length; face++) if (!selected || mask![face]) {
        for (let corner = 0; corner < 3; corner++) bounds.add(part.positions, part.indices[face * 3 + corner]! * 3, transform);
      }
    }
    return bounds.value;
  }
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, hits?: Uint8Array[]): SelectionSummary {
    const viewProjection = new Mat4().mul2(camera.projectionMatrix, camera.viewMatrix);
    const previous = operation === "add" ? this.parts.map(part => part.mask.slice()) : undefined;
    this.selected = 0;
    for (const [i, part] of this.parts.entries()) {
      const matrix = new Mat4().mul2(viewProjection, part.source.node.getWorldTransform());
      const count = hits ? applySelection(part.mask, hits[i]!, operation, this.isolated) :
        projectSelection(part.centers, part.mask, matrix.data, region, operation, this.isolated,
          sectionTest(this.app, part.centers, part.source.node.getWorldTransform()));
      this.selected += part.scope ? constrainMask(part.mask, part.scope) : count;
    }
    if (!this.selected) this.isolated = false;
    this.selectionAreas = recordSelectionGesture(this.selectionAreas, this.state, operation, previous);
    this.currentArea = currentSelectionArea(this.state, this.selectionAreas);
    this.refresh();
    return this.summary;
  }
  clear(): SelectionSummary {
    const saved = discardDraftSelection(this.paintState, this.selectionAreas);
    this.paintState = saved.colors;
    this.selectionAreas = saved.areas;
    for (const part of this.parts) part.mask.fill(0);
    this.selected = 0; this.isolated = false; this.currentArea = null; this.refresh(); return this.summary;
  }
  toggleIsolation(): SelectionSummary {
    this.isolated = this.selected > 0 && !this.isolated;
    this.refresh(); return this.summary;
  }
  private refresh() {
    this.visibility?.invalidateRays();
    this.clearPreviews();
    this.picker?.invalidate();
    const displayColors = visiblePaint(this.paintState, this.selectionAreas);
    const displaySelections = visibleSelections(this.selectionAreas, this.parts.map(part => part.mask.length));
    for (const [partIndex, part] of this.parts.entries()) {
      const subsets = new Map<number, number[]>(), colors = displayColors[partIndex]!;
      for (let face = 0; face < part.mask.length; face++) {
        if ((part.scope && !part.scope[face]) || (this.isolated && !part.mask[face])) continue;
        const highlighted = !!displaySelections[partIndex]![face];
        const key = (colors[face]! << 1) | Number(highlighted);
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
          const color = key >>> 1, selected = !!(key & 1);
          let material = part.baseMaterial;
          if (color || selected) {
            material = material.clone();
            const shade = color ? new Color().fromString(decodeColor(color)).linear() : this.tint;
            if (color) material.diffuse.lerp(material.diffuse, shade, this.tint.a);
            if (selected && !color) { material.emissive.copy(shade); material.emissiveIntensity = this.tint.a; }
            const reverse = color ? shade.clone().gamma() : reverseFaceColor.clone().lerp(reverseFaceColor, shade.clone().gamma(), this.tint.a);
            material.setParameter("portalReverseColor", [reverse.r, reverse.g, reverse.b]);
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
    this.visibility?.destroy();
    this.clearPreviews();
    for (const part of this.parts) {
      for (const { instance, material } of part.groups.values()) {
        part.layers.forEach(layer => layer.removeMeshInstances([instance]));
        instance.destroy();
        if (material !== part.baseMaterial) material.destroy();
      }
      part.previewMaterial?.destroy(); part.baseMaterial.destroy();
    }
    for (const { component, enabled } of this.originals) component.enabled = enabled;
  }
}
