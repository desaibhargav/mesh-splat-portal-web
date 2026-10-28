import { ASPECT_MANUAL, BLEND_NORMAL, Color, Entity, Layer, Plane, Quat, Ray, StandardMaterial, Vec3, type XrInputSource } from "playcanvas";
import type { SelectionHandle, SelectionShape, SelectionTool, SurfaceHit } from "../selection/types";
import type { SegmentWorkspaces, WorkspaceDocument } from "../segments/SegmentWorkspaces";
import { unpackSelection } from "../selection/SelectionHistory";
import { saveSelectionArea, decodeColor, encodeColor, nextSavedSelectionName } from "../selection/selectionColors";
import { snapshotContains } from "../selection/selectionSnapshot";
import type { AnnotationDraft, AnnotationRecord } from "../annotations/Annotations";
import type { ImmersiveInput } from "./ImmersiveInput";
import { SpatialPanel } from "./SpatialPanel";
import { toolAppearance } from "../toolAppearance";
import type { Point } from "../selection/rectangle";
import { Matrix4, Vector3 } from "three";
import type { SelectionArea, SelectionState } from "../selection/types";
import type { PaintState } from "../selection/selectionColors";
import type { ExtrudedSelectionVolume, BrushSelectionVolume, SelectionVolume } from "../selection/volume/SelectionVolume";
import { SelectionVolumeVisual } from "./SelectionVolumeVisual";

export class ImmersiveEditing {
  tool: SelectionTool = "navigate";
  shape: SelectionShape = "rectangle";
  brushSize = 10;
  xray = false;
  selectionName = "";
  selectionId: number | null = null;
  customColor = "#e53935";
  draft: AnnotationDraft | null = null;
  step: "choose" | "selection" | "marker" | "details" | "drag" | null = null;
  message = "";
  busy = false;
  dragging = false;
  private readonly tooltipRoot = new Entity("XR annotation tooltip");
  private readonly tooltipLayer = new Layer({ name: "XR annotation callouts", clearDepthBuffer: true });
  private readonly releaseTooltipLayer: () => void;
  private readonly tooltip: SpatialPanel;
  private tooltipRecord: AnnotationRecord | null = null;
  private readonly theme;
  private revision = 0;
  private disposed = false;
  private readonly cameraEntity = new Entity("XR selection gesture camera");
  private readonly strokeColor = new Color(1, .8, .3);
  starting: Promise<void> | null = null;
  private brush: Entity | null = null;
  private brushMaterial: StandardMaterial | null = null;
  private readonly brushRotation = new Quat();
  private readonly brushNormal = new Vec3();
  private gesture: { points: Point[]; depth: number; anchor: Vec3;
    surfacePoints: [number, number, number][]; radius: number; document: WorkspaceDocument } | null = null;
  private volumeVisual: SelectionVolumeVisual | null = null;
  private volumeBaseline: { state: SelectionState; colors: PaintState; areas: readonly SelectionArea[] } | null = null;
  private depthDrag: { origin: Vec3; depth: number; scale: number; axis: Vec3 } | null = null;
  private readonly plane = new Plane();
  private readonly ray = new Ray();
  private readonly point = new Vec3();
  private readonly screen = new Vec3();
  private readonly inverse = new Vec3();
  constructor(private readonly handle: SelectionHandle, private readonly workspaces: SegmentWorkspaces,
    private readonly input: ImmersiveInput, private readonly changed: () => void) {
    this.theme = toolAppearance(handle.app.graphicsDevice.canvas as HTMLCanvasElement);
    handle.app.scene.layers.push(this.tooltipLayer);
    this.releaseTooltipLayer = handle.viewports.shareLayer(this.tooltipLayer.id);
    handle.app.root.addChild(this.tooltipRoot);
    this.tooltip = new SpatialPanel(handle.app, "XR annotation description", 240, new Vec3(.025, .04, 0),
      this.tooltipRoot, () => {}, false, 0, false, this.tooltipLayer.id);
    this.tooltip.enabled = false; this.tooltip.entity.element!.useInput = false;
    this.tooltipLayer.enabled = false;
    handle.app.root.addChild(this.cameraEntity);
    this.cameraEntity.addComponent("camera", { enabled: false, fov: 90, nearClip: .005, farClip: 100, aspectRatioMode: ASPECT_MANUAL, aspectRatio: 1 });
  }
  get startPoint() { return this.gesture?.anchor ?? null; }
  get drawing() { return !!this.gesture; }
  get depthDragging() { return !!this.depthDrag; }
  depthHandleTarget(source: XrInputSource) {
    return this.depthHandleNear(source) ? this.volumeVisual!.handleWorld(new Vec3()) : null;
  }
  get annotations() { return this.workspaces.current.annotations; }
  get selection() { return this.handle.selection; }
  get displayedSelectionName() { return this.selectionName || (this.selectionId === null ?
    nextSavedSelectionName(this.selection.areas) : this.selection.areas.find(area => area.id === this.selectionId)?.name ?? ""); }
  private commit() { this.changed(); }
  setTool(tool: SelectionTool) {
    this.revision++; this.gesture = null; this.clearVolume(); this.selection.previewArea(null);
    if (tool !== "select" && this.brush) this.brush.enabled = false;
    if (tool !== this.tool) { this.selectionName = ""; this.selectionId = null; this.workspaces.history.perform(() => this.selection.clear()); this.input.invalidate(); }
    this.tool = tool; this.dragging = false; this.draft = null; this.step = tool === "annotate" ? "choose" : null; this.message = "";
    this.input.setNormalPicking(tool === "select" && this.shape === "brush");
  }
  action(action: string, value?: string | number) {
    if (this.busy) return;
    this.message = "";
    const history = this.workspaces.history;
    switch (action) {
      case "shape": this.clearVolume(); this.shape = value as SelectionShape;
        this.input.setNormalPicking(this.tool === "select" && this.shape === "brush"); break;
      case "brush": this.brushSize = Number(value); break;
      case "xray": this.xray = !this.xray; break;
      case "name": this.selectionName = String(value); break;
      case "color": this.customColor = String(value); break;
      case "paint": this.clearVolume(); history.perform(() => this.selection.paint(value === undefined ? encodeColor(this.customColor) : Number(value), this.workspaces.current.color)); break;
      case "clear": this.revision++; this.clearVolume(); history.perform(() => this.selection.clear()); this.selectionId = null; this.selectionName = ""; break;
      case "isolate": this.clearVolume(); history.perform(() => this.selection.toggleIsolation()); break;
      case "open": {
        this.clearVolume();
        const area = this.selection.areas.find(item => item.id === value); if (!area) return;
        history.perform(() => { this.selection.setAreaVisible(area.id, true); return this.selection.restore(unpackSelection(area.snapshot)); });
        this.selectionId = area.id; this.selectionName = area.name; break;
      }
      case "remove": this.clearVolume(); this.workspaces.removeSelection(Number(value)); this.selectionId = null; this.selectionName = ""; break;
      case "save": history.perform(() => {
        const areas = saveSelectionArea(this.selection.areas, this.selection.state, this.displayedSelectionName, this.selectionId);
        return this.selection.restore(unpackSelection(areas.at(-1)!.snapshot), this.selection.colors, areas);
      }); this.clearVolume(); this.selectionName = ""; this.selectionId = null; break;
    }
    if (["paint", "clear", "isolate", "open", "remove", "save"].includes(action)) this.input.invalidate();
    this.commit();
  }
  annotate(action: string, value?: string | number) {
    if (this.busy) return;
    this.revision++; this.message = "";
    switch (action) {
      case "point": case "selection":
        this.draft = { title: "", text: "", position: null, region: null, color: null };
        this.step = action === "point" ? "marker" : "selection"; break;
      case "title": if (this.draft) this.draft = { ...this.draft, title: String(value) }; break;
      case "text": if (this.draft) this.draft = { ...this.draft, text: String(value) }; break;
      case "open": case "move": {
        const record = this.annotations.records.find(item => item.id === value);
        if (record) { this.draft = { ...record }; this.step = action === "move" ? "drag" : "details"; } break;
      }
      case "remove": this.annotations.remove(Number(value)); if (this.draft?.id === value) this.draft = null; break;
      case "save": if (this.draft?.position && this.draft.title.trim()) this.annotations.save(this.draft); this.draft = null; this.step = null; break;
      case "new": this.step = "choose"; this.draft = null; break;
      case "cancel": this.draft = null; this.step = null; break;
    }
    this.selection.previewArea(null); this.commit();
  }
  beginAnnotationDrag(source: XrInputSource) {
    if (this.tool !== "annotate" || !this.draft?.position || (this.step !== "details" && this.step !== "drag")) return false;
    this.handle.space.toWorld(this.draft.position, this.point);
    this.screen.sub2(this.point, source.getOrigin()); const depth = this.screen.dot(source.getDirection());
    this.inverse.copy(source.getDirection()).mulScalar(depth).add(source.getOrigin());
    this.dragging = depth > 0 && this.inverse.distance(this.point) < .025;
    if (this.dragging) this.step = "drag";
    return this.dragging;
  }
  hover(hit: SurfaceHit | null, source?: XrInputSource) {
    const showBrush = this.tool === "select" && this.shape === "brush" && hit && source;
    if (showBrush) {
      if (!this.brush) {
        this.brush = new Entity("XR 3D brush"); this.handle.app.root.addChild(this.brush);
        this.brushMaterial = new StandardMaterial();
        this.brushMaterial.useLighting = false; this.brushMaterial.emissive.copy(this.strokeColor);
        this.brushMaterial.opacity = .18; this.brushMaterial.blendType = BLEND_NORMAL; this.brushMaterial.depthWrite = false;
        this.brushMaterial.update();
        this.brush.addComponent("render", { type: "cylinder", material: this.brushMaterial, castShadows: false, receiveShadows: false });
      }
      this.brush.enabled = true;
      this.handle.space.toWorld(hit.point, this.point);
      const bounds = this.selection.bounds(null), diameter = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z) * 2 * this.brushSize / 100 : .01;
      this.brushNormal.copy(hit.normal ?? source.getDirection().clone().mulScalar(-1)).normalize();
      this.brush.setPosition(this.point);
      this.brush.setRotation(this.brushRotation.setFromDirections(Vec3.UP, this.brushNormal));
      this.brush.setLocalScale(diameter, Math.max(.003, diameter * .06), diameter);
    } else if (this.brush) this.brush.enabled = false;

    if (this.dragging && hit && this.draft && (!this.draft.region || snapshotContains(this.draft.region, hit.part, hit.index)))
      this.draft = { ...this.draft, position: hit.point };

    const record = this.annotations.records.find(record => {
      if (!record.visible) return false;
      if (hit && record.region && snapshotContains(record.region, hit.part, hit.index)) return true;
      if (!source) return false;
      this.handle.space.toWorld(record.position, this.point);
      this.screen.sub2(this.point, source.getOrigin()); const depth = this.screen.dot(source.getDirection());
      this.inverse.copy(source.getDirection()).mulScalar(depth).add(source.getOrigin());
      return depth > 0 && this.inverse.distance(this.point) < .025;
    });
    this.tooltip.enabled = this.tooltipLayer.enabled = !!record;
    if (record) {
      this.handle.space.toWorld(record.position, this.point); this.tooltipRoot.setPosition(this.point);
      this.tooltipRoot.setRotation(this.handle.viewports.perspectivePanel.camera.entity.getRotation());
      if (record !== this.tooltipRecord) {
        this.tooltipRecord = record;
        const lines = [record.title];
        for (const paragraph of record.text.split("\n")) {
          let line = "";
          for (const word of paragraph.split(" ")) { if ((line + word).length > 32) { lines.push(line); line = ""; } line += `${word} `; }
          lines.push(line);
        }
        const ctx = this.tooltip.begin(16 + lines.length * 16); ctx.fillStyle = this.theme.panel; ctx.fillRect(0, 0, 240, 16 + lines.length * 16);
        ctx.fillStyle = this.theme.text; ctx.font = `12px ${this.theme.font}`; ctx.textBaseline = "top";
        lines.forEach((line, i) => ctx.fillText(line, 8, 8 + i * 16)); this.tooltip.finish();
      }
    } else this.tooltipRecord = null;
    if (this.tool !== "annotate" || this.step !== "selection") return;
    const area = hit && this.selection.areaAt(hit.part, hit.index);
    this.selection.previewArea(area || null);
    const message = area ? `Click ${area.name} to annotate it` : "Hover over a selection, then click it";
    if (this.message !== message) { this.message = message; this.changed(); }
  }
  async click(source: XrInputSource) {
    if (this.tool !== "annotate" || this.busy) return;
    const token = this.revision, document = this.workspaces.current;
    this.busy = true;
    try {
      const hit = await this.input.pick(source);
      if (this.disposed || token !== this.revision || document !== this.workspaces.current || !hit) return;
      if (this.step === "selection") {
        const area = this.selection.areaAt(hit.part, hit.index);
        if (area && this.draft) { this.draft = { ...this.draft, selectionId: area.id, region: area.snapshot, color: area.color ? decodeColor(area.color) : null }; this.step = "marker"; }
      } else if ((this.step === "marker" || this.step === "drag") && this.draft) {
        if (this.draft.region && !snapshotContains(this.draft.region, hit.part, hit.index)) { this.message = "Place the marker on the chosen selection."; return; }
        this.draft = { ...this.draft, position: hit.point }; this.step = "details";
      }
      this.selection.previewArea(null); this.message = "";
    } catch (error) { this.message = String(error); }
    finally { this.dragging = false; this.busy = false; if (!this.disposed) this.commit(); }
  }
  start(source: XrInputSource) {
    if (this.tool !== "select" || this.busy || this.starting) return;
    if (this.beginDepthDrag(source)) return;
    this.starting = this.begin(source).finally(() => { this.starting = null; });
  }
  depthHandleNear(source: XrInputSource) {
    const visual = this.volumeVisual;
    if (!visual || this.shape === "brush") return false;
    const handle = visual.handleWorld(this.point);
    this.screen.sub2(handle, source.getOrigin());
    const along = this.screen.dot(source.getDirection());
    this.inverse.copy(source.getDirection()).mulScalar(along).add(source.getOrigin());
    return along > 0 && this.inverse.distance(handle) <= .065;
  }
  private beginDepthDrag(source: XrInputSource) {
    const visual = this.volumeVisual;
    if (!visual || !this.depthHandleNear(source)) return false;
    const axis = visual.axisWorld(new Vec3());
    const scale = axis.length();
    if (scale < 1e-8) return false;
    this.depthDrag = { origin: (source.getPosition() ?? source.getOrigin()).clone(), depth: visual.volume.depth,
      scale, axis: axis.mulScalar(1 / scale) };
    return true;
  }
  private async begin(source: XrInputSource) {
    const token = this.revision, origin = source.getOrigin().clone(), direction = source.getDirection().clone();
    this.busy = true;
    let hit: SurfaceHit | null;
    try { hit = await this.input.pick(source); }
    catch (error) { this.message = String(error); return; }
    finally { this.busy = false; }
    if (this.disposed || token !== this.revision) return;
    if (!hit) { this.message = "Point at the asset to begin selecting."; this.changed(); return; }
    this.clearVolume();
    const camera = this.cameraEntity.camera!;
    this.cameraEntity.setPosition(origin);
    this.cameraEntity.lookAt(this.point.copy(direction).add(origin), this.handle.viewports.perspectivePanel.camera.entity.up);
    camera.onAppPrerender(); // Disabled query cameras need the native transform invalidation explicitly.
    const bounds = this.selection.bounds(null);
    const anchor = this.handle.space.toWorld(hit.point);
    const depth = Math.max(camera.nearClip, this.point.sub2(anchor, origin).dot(this.cameraEntity.forward));
    this.plane.setFromPointNormal(this.point.copy(this.cameraEntity.forward).mulScalar(depth).add(origin), this.cameraEntity.forward);
    const worldDiameter = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z) * 2 * this.brushSize / 100 : .01;
    this.gesture = { points: [], depth, anchor: hit.point.clone(),
      surfacePoints: [anchor.toArray() as [number, number, number]], radius: Math.max(.005, worldDiameter / 2),
      document: this.workspaces.current };
    const rectStart = this.handle.app.graphicsDevice.clientRect;
    camera.worldToScreen(anchor, this.screen);
    this.gesture.points.push({ x: this.screen.x / rectStart.width * 512, y: this.screen.y / rectStart.height * 512 });
    if (this.shape !== "brush") this.showGestureVolume();
    this.track(source);
  }
  track(source: XrInputSource) {
    if (this.depthDrag && this.volumeVisual) {
      const drag = this.depthDrag;
      const displacement = this.point.sub2(source.getPosition() ?? source.getOrigin(), drag.origin).dot(drag.axis);
      const bounds = this.selection.bounds(null);
      const max = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z) * 4 : 100;
      const depth = Math.max(.001, Math.min(max, drag.depth + displacement / drag.scale));
      if (Math.abs(depth - this.volumeVisual.volume.depth) > 1e-4) {
        this.volumeVisual.volume.depth = depth; this.volumeVisual.update();
      }
      return;
    }
    if (!this.gesture) return;
    if (this.shape === "brush") {
      const hit = this.input.hit(source);
      if (!hit) return;
      this.handle.space.toWorld(hit.point, this.point);
      const last = this.gesture.surfacePoints.at(-1)!;
      if (this.point.distance(new Vec3(...last)) >= this.gesture.radius * .25)
        this.gesture.surfacePoints.push(this.point.toArray() as [number, number, number]);
      return;
    }
    // A fixed controller-view projection per stroke makes box/lasso/brush
    // deterministic while the headset moves; native camera math maps the ray.
    this.ray.set(source.getOrigin(), source.getDirection());
    if (!this.plane.intersectsRay(this.ray, this.point)) return;
    this.cameraEntity.camera!.worldToScreen(this.point, this.screen);
    const rect = this.handle.app.graphicsDevice.clientRect;
    const next = { x: Math.max(0, Math.min(512, this.screen.x / rect.width * 512)), y: Math.max(0, Math.min(512, this.screen.y / rect.height * 512)) };
    const path = this.gesture.points, last = path.at(-1);
    if (last && Math.hypot(last.x - next.x, last.y - next.y) < 1) return;
    path.push(next);
    this.showGestureVolume();
  }
  private showGestureVolume() {
    if (!this.gesture) return;
    // Stroke geometry is bounded and changes only when the pointer advances.
    // The worker selection query still runs only after trigger release.
    try {
      const volume = this.makeVolume(this.gesture, true);
      if (!volume) return;
      if (this.volumeVisual) this.volumeVisual.setOutline(volume.outline);
      else {
        const root = new Matrix4().fromArray(this.handle.space.root.getWorldTransform().data);
        const localFrame = root.clone().invert().multiply(new Matrix4().fromArray(volume.matrix));
        this.volumeVisual = new SelectionVolumeVisual(this.handle, volume, localFrame, this.theme.gold);
      }
    } catch { /* A lasso can be temporarily open or self crossing while drawing. */ }
  }
  async end() {
    await this.starting;
    if (this.depthDrag) {
      this.depthDrag = null;
      if (this.volumeVisual) await this.commitVolume(this.volumeVisual.volume, true);
      return;
    }
    const gesture = this.gesture; this.gesture = null;
    if (!gesture || gesture.points.length === 0) return;
    if (this.shape !== "brush") {
      try {
        const volume = this.makeVolume(gesture);
        if (!volume) { this.message = "Draw a larger selection volume."; this.commit(); return; }
        this.volumeBaseline = { state: { masks: this.selection.state.masks.map(mask => mask.slice()), isolated: this.selection.state.isolated },
          colors: this.selection.colors, areas: this.selection.areas };
        if (this.volumeVisual) this.volumeVisual.setOutline(volume.outline);
        else {
          const root = new Matrix4().fromArray(this.handle.space.root.getWorldTransform().data);
          const localFrame = root.clone().invert().multiply(new Matrix4().fromArray(volume.matrix));
          this.volumeVisual = new SelectionVolumeVisual(this.handle, volume, localFrame, this.theme.gold);
        }
        await this.commitVolume(this.volumeVisual.volume, false);
      } catch (error) { this.clearVolume(); this.message = String(error); this.commit(); }
      return;
    }
    const camera = this.cameraEntity.camera!, token = this.revision;
    const volume: BrushSelectionVolume = { shape: "brush", centers: gesture.surfacePoints, radius: gesture.radius };
    const region = { pixels: new Uint8ClampedArray(1), width: 1, height: 1 };
    const view = { projectionMatrix: camera.projectionMatrix.clone(), viewMatrix: camera.viewMatrix.clone() };
    this.busy = true; this.changed();
    try {
      const hits = await this.selection.selectVolume(volume);
      if (!this.disposed && token === this.revision && this.workspaces.current === gesture.document)
        this.workspaces.history.perform(() => this.selection.select(region, "add", view, hits));
    } catch (error) { this.message = String(error); }
    finally { this.busy = false; this.input.invalidate(); if (!this.disposed) this.commit(); }
  }
  private makeVolume(gesture: NonNullable<typeof this.gesture>, preview = false): ExtrudedSelectionVolume | null {
    let path = gesture.points;
    if (preview && path.length < (this.shape === "lasso" ? 3 : 2)) {
      const first = path[0]!;
      path = this.shape === "lasso"
        ? [...path, ...(path.length === 1 ? [{ x: first.x + 8, y: first.y }] : []),
          { x: first.x + 4, y: first.y + 8 }]
        : [first, { x: first.x + 8, y: first.y + 8 }];
    }
    if (path.length < 2) return null;
    const anchor = this.handle.space.toWorld(gesture.anchor);
    const camera = this.cameraEntity, rect = this.handle.app.graphicsDevice.clientRect;
    const bounds = this.selection.bounds(null);
    const forward = camera.forward, far = bounds?.getMax(), near = bounds?.getMin();
    const farCorner = far && near ? new Vec3(
      forward.x > 0 ? far.x : near.x,
      forward.y > 0 ? far.y : near.y,
      forward.z > 0 ? far.z : near.z) : anchor;
    const span = bounds ? bounds.halfExtents.length() * 2 : .1;
    const back = Math.max(0, farCorner.clone().sub(anchor).dot(forward)) + Math.max(.01, span * .02);
    const worldFrame = new Matrix4().makeBasis(
      new Vector3(camera.right.x, camera.right.y, camera.right.z),
      new Vector3(camera.up.x, camera.up.y, camera.up.z),
      new Vector3(-forward.x, -forward.y, -forward.z));
    worldFrame.setPosition(anchor.x + forward.x * back, anchor.y + forward.y * back, anchor.z + forward.z * back);
    const inverse = worldFrame.clone().invert();
    const project = (point: Point): [number, number] => {
      camera.camera!.screenToWorld(point.x / 512 * rect.width, point.y / 512 * rect.height, gesture.depth, this.inverse);
      const local = new Vector3(this.inverse.x, this.inverse.y, this.inverse.z).applyMatrix4(inverse);
      return [local.x, local.y];
    };
    let outline: [number, number][];
    if (this.shape === "rectangle") {
      const [x0, y0] = project(path[0]!), [x1, y1] = project(path.at(-1)!);
      outline = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    } else {
      const stride = Math.max(1, Math.ceil(path.length / 128));
      outline = path.filter((_, i) => i === 0 || i === path.length - 1 || i % stride === 0).map(project);
    }
    if (outline.length < 3) return null;
    const depth = back + Math.max(.03, span * .12);
    return { shape: this.shape as "rectangle" | "lasso", matrix: worldFrame.toArray(), outline, depth };
  }
  private async commitVolume(volume: SelectionVolume, adjustment: boolean) {
    const baseline = this.volumeBaseline;
    if (!baseline) return;
    const token = ++this.revision, document = this.workspaces.current;
    this.busy = true; this.changed();
    try {
      this.volumeVisual?.update();
      const hits = await this.selection.selectVolume(volume);
      if (this.disposed || token !== this.revision || document !== this.workspaces.current) return;
      const camera = this.cameraEntity.camera!;
      const view = { projectionMatrix: camera.projectionMatrix.clone(), viewMatrix: camera.viewMatrix.clone() };
      const region = { pixels: new Uint8ClampedArray(1), width: 1, height: 1 };
      this.workspaces.history.perform(() => {
        if (adjustment) this.selection.restore({ masks: baseline.state.masks.map(mask => mask.slice()), isolated: baseline.state.isolated },
          baseline.colors, baseline.areas);
        return this.selection.select(region, "add", view, hits);
      });
    } catch (error) { this.message = String(error); if (!adjustment) this.clearVolume(); }
    finally { this.busy = false; this.input.invalidate(); if (!this.disposed) this.commit(); }
  }
  clearVolume() { this.depthDrag = null; this.volumeVisual?.destroy(); this.volumeVisual = null; this.volumeBaseline = null; }
  cancelGesture() {
    this.dragging = false; this.revision++; this.gesture = null;
    if (this.depthDrag && this.volumeVisual) { this.volumeVisual.volume.depth = this.depthDrag.depth; this.volumeVisual.update(); }
    this.depthDrag = null;
  }
  destroy() { this.disposed = true; this.revision++; this.selection.previewArea(null); this.clearVolume();
    this.brush?.destroy(); this.brushMaterial?.destroy(); this.cameraEntity.destroy(); this.tooltip.destroy(); this.tooltipRoot.destroy();
    this.releaseTooltipLayer(); this.handle.app.scene.layers.remove(this.tooltipLayer); }
}
