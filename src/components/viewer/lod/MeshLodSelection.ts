import { Asset, BoundingBox, type AppBase, type Camera, type CameraComponent, type Color, type Entity } from "playcanvas";
import { MeshSelection } from "../selection/MeshSelection";
import { applySelection } from "../selection/projectSelection";
import { currentSelectionArea, paintSelection, recordSelectionGesture, selectionAreaAt, updateSelectionAreas, type PaintState } from "../selection/selectionColors";
import { packSelection, snapshotContains, unpackSelection } from "../selection/selectionSnapshot";
import type { SelectionArea, SelectionCamera, SelectionController, SelectionRegion, SelectionSnapshot, SelectionState, SelectionSummary } from "../selection/types";
import type { SelectionOperation } from "../selection/rectangle";
import { SelectionBounds } from "../selection/selectionBounds";
import type { ViewerViewports } from "../viewports/ViewerViewports";
import type { LodData, LodMapping } from "./LodData";
import { ThreeLod } from "./ThreeLod";
import { LOD_HYSTERESIS, LOD_TRANSITIONS, lodMetric } from "./lodMetric";

interface Level { index: number; selection: MeshSelection; mapping: LodMapping; version: number; asset?: Asset; entity?: Entity }

function offsets(sizes: readonly number[]) {
  let cursor = 0;
  return sizes.map(size => { const offset = cursor; cursor += size; return offset; });
}
function flatIndex(parts: readonly number[], part: number, index: number) {
  for (let i = 0; i < part; i++) index += parts[i]!;
  return index;
}
function split<T extends Uint8Array | Uint32Array>(values: T, parts: readonly number[]): T[] {
  return offsets(parts).map((offset, index) => values.subarray(offset, offset + parts[index]!) as T);
}
function flatten<T extends Uint8Array | Uint32Array>(parts: readonly T[], result: T): T {
  let cursor = 0;
  for (const part of parts) { result.set(part, cursor); cursor += part.length; }
  return result;
}

// The document keeps finest-published IDs. Each loaded geometry is only a
// projection of that document. Camera changes never replace the tool handle,
// history, saved masks, annotation bindings or paint records.
export class MeshLodSelection implements SelectionController {
  private masks: Uint8Array[];
  private paintState: PaintState;
  private selectionAreas: readonly SelectionArea[] = [];
  private isolated = false;
  private selected = 0;
  private version = 0;
  private disposed = false;
  private readonly levels = new Map<number, Level>();
  private readonly pending = new Map<number, Promise<void>>();
  private readonly downloads = new AbortController();
  private readonly selectors = new WeakMap<CameraComponent, ThreeLod>();
  private readonly snapshots = new WeakMap<SelectionSnapshot, Map<number, SelectionSnapshot>>();
  private readonly hitLevels = new WeakMap<Uint8Array[], Level>();
  private preview: SelectionArea | null = null;
  private readonly canonicalParts: readonly number[];
  private readonly frameLevels = new Map<CameraComponent, Level>();
  private cachedBounds?: BoundingBox;
  private readonly flatMask: Uint8Array;
  private readonly flatColors: Uint32Array;
  private flattenedVersion = -1;
  private flattenedColors?: PaintState;

  private constructor(private readonly app: AppBase, private readonly root: Entity, private readonly tint: Color,
    private readonly data: LodData, private readonly viewports: ViewerViewports, private readonly onError: (error: Error) => void) {
    this.canonicalParts = data.descriptor.editing.parts[0]!;
    this.masks = this.canonicalParts.map(size => new Uint8Array(size));
    this.paintState = this.canonicalParts.map(size => new Uint32Array(size));
    this.flatMask = new Uint8Array(data.centers.length / 3);
    this.flatColors = new Uint32Array(this.flatMask.length);
    app.on("prerender", this.prepareFrame, this);
  }

  static create(app: AppBase, root: Entity, tint: Color, data: LodData, viewports: ViewerViewports, initial: MeshSelection, onError: (error: Error) => void) {
    const selection = new MeshLodSelection(app, root, tint, data, viewports, onError);
    try {
      selection.attach({ index: 2, selection: initial, mapping: data.readyMapping(2), version: -1 });
      return selection;
    } catch (error) { selection.destroy(); throw error; }
  }

  private attach(level: Level) {
    const masks = level.selection.state.masks;
    if (masks.length !== level.mapping.parts.length || level.mapping.parts.some((size, part) => size !== masks[part]?.length)) {
      throw new Error("Mesh primitive ordering differs from its correspondence metadata.");
    }
    this.levels.set(level.index, level);
    try {
      level.selection.updateSection();
      level.selection.setVisibility(camera => this.forNativeCamera(camera) === level);
      this.sync(level);
    } catch (error) { this.levels.delete(level.index); throw error; }
  }
  private forNativeCamera(camera: Camera) {
    const component = this.viewports.panels.find(panel => panel.camera.camera === camera)?.camera;
    return this.forCamera(component ?? this.viewports.active.camera);
  }
  private forCamera(camera: CameraComponent): Level {
    const cached = this.frameLevels.get(camera);
    if (cached) return cached;
    let selector = this.selectors.get(camera);
    if (!selector) {
      selector = new ThreeLod();
      for (const distance of LOD_TRANSITIONS) selector.addLevel({ visible: false }, distance, LOD_HYSTERESIS);
      this.selectors.set(camera, selector);
    }
    selector.update(lodMetric(camera, this.wholeBounds()));
    const desired = selector.getCurrentLevel();
    if (!this.levels.has(desired)) this.load(desired);
    let result = this.levels.get(desired);
    if (!result) for (const level of this.levels.values()) {
      if (!result || Math.abs(level.index - desired) < Math.abs(result.index - desired)) result = level;
    }
    this.frameLevels.set(camera, result!);
    return result!;
  }
  private prepareFrame() {
    if (this.disposed) return;
    this.frameLevels.clear(); this.cachedBounds = undefined;
    for (const panel of this.viewports.visible) this.sync(this.forCamera(panel.camera));
  }
  private load(index: number) {
    if (this.disposed || this.pending.has(index)) return;
    const task = (async () => {
      const url = this.data.file(this.data.descriptor.levels[index]!.file!);
      // Native container decoding has no cancelable download. Supply its public
      // in-memory file input only while this viewer still owns a live device.
      const response = await fetch(url, { signal: this.downloads.signal });
      if (!response.ok) throw new Error(`Mesh LOD request failed (${response.status}).`);
      const contents = await response.arrayBuffer();
      if (this.disposed) return;
      const asset = new Asset(`LOD ${index}`, "container", { url, contents });
      this.app.assets.add(asset);
      let entity: Entity | undefined;
      let selection: MeshSelection | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          asset.once("load", () => resolve()); asset.once("error", (error: unknown) => reject(error)); this.app.assets.load(asset);
        });
        if (this.disposed) return;
        entity = (asset.resource as { instantiateRenderEntity(): Entity }).instantiateRenderEntity();
        this.root.addChild(entity);
        selection = new MeshSelection(entity, this.app, this.tint);
        const mapping = this.data.readyMapping(index);
        this.attach({ index, selection, mapping, version: -1, asset, entity });
      } finally {
        if (asset.file) Object.assign(asset.file, { contents: null });
        if (!this.levels.has(index)) {
          selection?.destroy(); entity?.destroy();
          this.app.assets.remove(asset); asset.unload();
        }
      }
    })().catch(error => { if (!this.disposed) this.onError(error instanceof Error ? error : new Error(String(error))); });
    this.pending.set(index, task);
  }

  private projectedSnapshot(snapshot: SelectionSnapshot, level: Level): SelectionSnapshot {
    let cache = this.snapshots.get(snapshot);
    if (!cache) { cache = new Map(); this.snapshots.set(snapshot, cache); }
    let projected = cache.get(level.index);
    if (!projected) {
      const fine = flatten(unpackSelection(snapshot).masks, new Uint8Array(this.data.centers.length / 3));
      const coarse = Uint8Array.from(level.mapping.from, index => fine[index]!);
      projected = packSelection({ masks: split(coarse, level.mapping.parts), isolated: snapshot.isolated });
      cache.set(level.index, projected);
    }
    return projected;
  }
  private projectArea(area: SelectionArea, level: Level): SelectionArea {
    return { ...area, snapshot: this.projectedSnapshot(area.snapshot, level) };
  }
  private sync(level: Level) {
    if (level.version === this.version) return;
    if (this.flattenedVersion !== this.version) {
      flatten(this.masks, this.flatMask); this.flattenedVersion = this.version;
    }
    if (this.flattenedColors !== this.paintState) {
      flatten(this.paintState, this.flatColors); this.flattenedColors = this.paintState;
    }
    const fine = this.flatMask, colors = this.flatColors;
    level.selection.restore({ masks: split(Uint8Array.from(level.mapping.from, index => fine[index]!), level.mapping.parts), isolated: this.isolated },
      split(Uint32Array.from(level.mapping.from, index => colors[index]!), level.mapping.parts),
      this.selectionAreas.map(area => this.projectArea(area, level)));
    level.version = this.version;
    level.selection.previewArea(this.preview ? this.projectArea(this.preview, level) : null);
  }
  private changed() {
    this.version++;
    this.selected = this.masks.reduce((sum, mask) => sum + mask.reduce((count, value) => count + Number(!!value), 0), 0);
    for (const panel of this.viewports.visible) this.sync(this.forCamera(panel.camera));
    return this.summary;
  }
  get state(): SelectionState { return { masks: this.masks, isolated: this.isolated }; }
  get colors() { return this.paintState; }
  get areas() { return this.selectionAreas; }
  get summary(): SelectionSummary { return { selected: this.selected, total: this.data.centers.length / 3, isolated: this.isolated }; }
  get layers() { return this.levels.values().next().value!.selection.layers; }
  updateSection() {
    this.cachedBounds = undefined; this.frameLevels.clear();
    for (const level of this.levels.values()) level.selection.updateSection();
  }
  async primitiveAt(app: AppBase, camera: CameraComponent, u: number, v: number) {
    const level = this.forCamera(camera);
    const hit = await level.selection.primitiveAt(app, camera, u, v);
    if (!hit || this.disposed) return null;
    let index = level.mapping.from[flatIndex(level.mapping.parts, hit.part, hit.index)]!;
    let part = 0;
    while (index >= this.canonicalParts[part]!) index -= this.canonicalParts[part++]!;
    return { part, index };
  }
  async hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion) {
    const level = this.forCamera(camera), hits = await level.selection.hitTest(app, camera, region);
    this.hitLevels.set(hits, level); return hits;
  }
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, hits?: Uint8Array[]) {
    const level = hits ? this.hitLevels.get(hits)! : this.forCamera(this.viewports.active.camera);
    const coarse = flatten(hits ?? level.selection.project(region, camera), new Uint8Array(level.mapping.from.length));
    const fine = Uint8Array.from(level.mapping.to, index => coarse[index]!);
    for (let index = 0; index < coarse.length; index++) if (coarse[index]) fine[level.mapping.from[index]!] = 1;
    const previous = operation === "add" ? this.masks.map(mask => mask.slice()) : undefined;
    const expanded = split(fine, this.canonicalParts);
    for (const [part, mask] of this.masks.entries()) applySelection(mask, expanded[part]!, operation, this.isolated);
    if (!this.masks.some(mask => mask.some(Boolean))) this.isolated = false;
    this.selectionAreas = recordSelectionGesture(this.selectionAreas, this.state, operation, previous);
    return this.changed();
  }
  areaAt(part: number, index: number) {
    return selectionAreaAt(this.selectionAreas.filter(area => area.visible), part, index) ??
      (this.currentArea && snapshotContains(this.currentArea.snapshot, part, index) ? this.currentArea : null);
  }
  private get currentArea() { return currentSelectionArea(this.state, this.selectionAreas); }
  previewArea(area: SelectionArea | null) {
    if (this.preview?.snapshot === area?.snapshot) return;
    this.preview = area;
    for (const level of this.levels.values()) level.selection.previewArea(area ? this.projectArea(area, level) : null);
  }
  renameArea(id: number, name: string) {
    const value = name.trim();
    if (!value || this.selectionAreas.find(area => area.id === id)?.name === value) return this.summary;
    this.selectionAreas = this.selectionAreas.map(area => area.id === id ? { ...area, name: value } : area);
    return this.changed();
  }
  setAreaVisible(id: number, visible: boolean) {
    if (this.selectionAreas.find(area => area.id === id)?.visible === visible) return this.summary;
    this.selectionAreas = this.selectionAreas.map(area => area.id === id ? { ...area, visible } : area);
    return this.changed();
  }
  paint(color: number) {
    const current = this.currentArea;
    const next = paintSelection(this.paintState, this.masks, color, current?.color);
    if (next === this.paintState) return this.summary;
    this.selectionAreas = updateSelectionAreas(this.selectionAreas, this.paintState, this.masks, color);
    this.paintState = next;
    return this.changed();
  }
  restore(state: SelectionState, colors = this.paintState, areas = this.selectionAreas) {
    this.masks = state.masks.map(mask => mask.slice()); this.isolated = state.isolated;
    this.paintState = colors; this.selectionAreas = areas; return this.changed();
  }
  clear() {
    const current = this.currentArea;
    if (!this.selected && !this.isolated && !current) return this.summary;
    if (current && !current.color) this.selectionAreas = this.selectionAreas.map(area => area.id === current.id ? { ...area, visible: false } : area);
    this.masks.forEach(mask => mask.fill(0)); this.isolated = false; return this.changed();
  }
  toggleIsolation() {
    if (!this.selected) return this.summary;
    this.isolated = !this.isolated; return this.changed();
  }
  private wholeBounds(): BoundingBox {
    return this.cachedBounds ??= this.levels.values().next().value!.selection.bounds(null)!;
  }
  bounds(state: SelectionState | null = this.state) {
    if (!state || !state.masks.some(mask => mask.some(Boolean))) return this.wholeBounds();
    const bounds = new SelectionBounds(), transform = this.root.getWorldTransform();
    const starts = offsets(this.canonicalParts);
    state.masks.forEach((mask, part) => mask.forEach((value, index) => { if (value) bounds.add(this.data.centers, (starts[part]! + index) * 3, transform); }));
    return bounds.value;
  }
  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.downloads.abort();
    this.app.off("prerender", this.prepareFrame, this);
    for (const level of this.levels.values()) {
      level.selection.destroy(); level.entity?.destroy();
      if (level.asset) { this.app.assets.remove(level.asset); level.asset.unload(); }
    }
    this.levels.clear();
  }
}
