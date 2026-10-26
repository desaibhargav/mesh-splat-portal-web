import { ASPECT_MANUAL, Color, Entity, Plane, Ray, Vec3, WideLine, WideLineRenderer, type XrInputSource } from "playcanvas";
import type { SelectionHandle, SelectionShape, SelectionTool, SurfaceHit } from "../selection/types";
import type { SegmentWorkspaces, WorkspaceDocument } from "../segments/SegmentWorkspaces";
import { rasterizeGesture } from "../selection/rasterizeGesture";
import { unpackSelection } from "../selection/SelectionHistory";
import { saveSelectionArea, decodeColor, encodeColor } from "../selection/selectionColors";
import { snapshotContains } from "../selection/selectionSnapshot";
import type { AnnotationDraft, AnnotationRecord } from "../annotations/Annotations";
import type { ImmersiveInput } from "./ImmersiveInput";
import { SpatialPanel } from "./SpatialPanel";
import { toolAppearance } from "../toolAppearance";
import type { Point } from "../selection/rectangle";

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
  private readonly tooltip: SpatialPanel;
  private tooltipRecord: AnnotationRecord | null = null;
  private readonly theme;
  private revision = 0;
  private disposed = false;
  private readonly cameraEntity = new Entity("XR selection gesture camera");
  private readonly lines: WideLineRenderer;
  private line: WideLine | null = null;
  private readonly strokeColor = new Color(1, .8, .3);
  starting: Promise<void> | null = null;
  private brush: WideLine | null = null;
  private brushVisible = false;
  private readonly brushPoints = new Float32Array(49 * 3);
  private readonly tangent = new Vec3();
  private readonly bitangent = new Vec3();
  private gesture: { points: Point[]; diameter: number; depth: number; anchor: Vec3; document: WorkspaceDocument } | null = null;
  private readonly plane = new Plane();
  private readonly ray = new Ray();
  private readonly point = new Vec3();
  private readonly screen = new Vec3();
  private readonly inverse = new Vec3();
  constructor(private readonly handle: SelectionHandle, private readonly workspaces: SegmentWorkspaces,
    private readonly input: ImmersiveInput, private readonly changed: () => void) {
    this.theme = toolAppearance(handle.app.graphicsDevice.canvas as HTMLCanvasElement);
    handle.app.root.addChild(this.tooltipRoot);
    this.tooltip = new SpatialPanel(handle.app, "XR annotation description", 240, new Vec3(.025, .04, 0), this.tooltipRoot, () => {});
    this.tooltip.enabled = false; this.tooltip.entity.element!.useInput = false;
    handle.app.root.addChild(this.cameraEntity);
    this.cameraEntity.addComponent("camera", { enabled: false, fov: 90, nearClip: .005, farClip: 100, aspectRatioMode: ASPECT_MANUAL, aspectRatio: 1 });
    this.lines = new WideLineRenderer(handle.app); this.lines.depthTest = false; this.lines.depthWrite = false;
  }
  get startPoint() { return this.gesture?.anchor ?? null; }
  get drawing() { return !!this.gesture; }
  get annotations() { return this.workspaces.current.annotations; }
  get selection() { return this.handle.selection; }
  private commit() { this.changed(); }
  setTool(tool: SelectionTool) {
    this.revision++; this.gesture = null; this.clearLine(); this.selection.previewArea(null);
    if (tool !== "select" && this.brush && this.brushVisible) { this.lines.remove(this.brush); this.brushVisible = false; }
    if (tool !== this.tool) { this.selectionName = ""; this.selectionId = null; this.workspaces.history.perform(() => this.selection.clear()); this.input.invalidate(); }
    this.tool = tool; this.dragging = false; this.draft = null; this.step = tool === "annotate" ? "choose" : null; this.message = "";
  }
  action(action: string, value?: string | number) {
    if (this.busy) return;
    this.message = "";
    const history = this.workspaces.history;
    switch (action) {
      case "shape": this.shape = value as SelectionShape; break;
      case "brush": this.brushSize = Number(value); break;
      case "xray": this.xray = !this.xray; break;
      case "name": this.selectionName = String(value); break;
      case "color": this.customColor = String(value); break;
      case "paint": history.perform(() => this.selection.paint(value === undefined ? encodeColor(this.customColor) : Number(value), this.workspaces.current.color)); break;
      case "clear": this.revision++; history.perform(() => this.selection.clear()); this.selectionId = null; this.selectionName = ""; break;
      case "isolate": history.perform(() => this.selection.toggleIsolation()); break;
      case "open": {
        const area = this.selection.areas.find(item => item.id === value); if (!area) return;
        history.perform(() => { this.selection.setAreaVisible(area.id, true); return this.selection.restore(unpackSelection(area.snapshot)); });
        this.selectionId = area.id; this.selectionName = area.name; break;
      }
      case "remove": this.workspaces.removeSelection(Number(value)); this.selectionId = null; this.selectionName = ""; break;
      case "save": history.perform(() => {
        const areas = saveSelectionArea(this.selection.areas, this.selection.state, this.selectionName, this.selectionId);
        return this.selection.restore(unpackSelection(areas.at(-1)!.snapshot), this.selection.colors, areas);
      }); this.selectionName = ""; this.selectionId = null; break;
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
        this.brush = new WideLine().set(this.brushPoints, this.strokeColor, 3);
      }
      if (!this.brushVisible) { this.lines.add(this.brush); this.brushVisible = true; }
      this.handle.space.toWorld(hit.point, this.point);
      const bounds = this.selection.bounds(null), diameter = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z) * 2 * this.brushSize / 100 : .01;
      const radius = Math.max(.005, diameter / 2);
      this.tangent.cross(source.getDirection(), Vec3.UP).normalize();
      if (this.tangent.lengthSq() < .01) this.tangent.cross(source.getDirection(), Vec3.RIGHT).normalize();
      this.bitangent.cross(source.getDirection(), this.tangent).normalize();
      for (let i = 0; i <= 48; i++) {
        const angle = i / 48 * Math.PI * 2, offset = i * 3;
        this.brushPoints[offset] = this.point.x + radius * (this.tangent.x * Math.cos(angle) + this.bitangent.x * Math.sin(angle));
        this.brushPoints[offset + 1] = this.point.y + radius * (this.tangent.y * Math.cos(angle) + this.bitangent.y * Math.sin(angle));
        this.brushPoints[offset + 2] = this.point.z + radius * (this.tangent.z * Math.cos(angle) + this.bitangent.z * Math.sin(angle));
      }
      this.brush.setPositions(this.brushPoints);
    } else if (this.brush && this.brushVisible) { this.lines.remove(this.brush); this.brushVisible = false; }

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
    this.tooltip.enabled = !!record;
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
    this.starting = this.begin(source).finally(() => { this.starting = null; });
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
    const camera = this.cameraEntity.camera!;
    this.cameraEntity.setPosition(origin);
    this.cameraEntity.lookAt(this.point.copy(direction).add(origin), this.handle.viewports.perspectivePanel.camera.entity.up);
    camera.onAppPrerender(); // Disabled query cameras need the native transform invalidation explicitly.
    const bounds = this.selection.bounds(null), rect = this.handle.app.graphicsDevice.clientRect;
    const anchor = this.handle.space.toWorld(hit.point);
    const depth = Math.max(camera.nearClip, this.point.sub2(anchor, origin).dot(this.cameraEntity.forward));
    this.plane.setFromPointNormal(this.point.copy(this.cameraEntity.forward).mulScalar(depth).add(origin), this.cameraEntity.forward);
    const worldDiameter = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z) * 2 * this.brushSize / 100 : .01;
    this.gesture = { points: [], depth, anchor: hit.point.clone(), diameter: worldDiameter * camera.projectionMatrix.data[5]! / depth * 256,
      document: this.workspaces.current };
    const rectStart = this.handle.app.graphicsDevice.clientRect;
    camera.worldToScreen(anchor, this.screen);
    this.gesture.points.push({ x: this.screen.x / rectStart.width * 512, y: this.screen.y / rectStart.height * 512 });
    this.track(source);
  }
  track(source: XrInputSource) {
    if (!this.gesture) return;
    // A fixed controller-view projection per stroke makes box/lasso/brush
    // deterministic while the headset moves; native camera math maps the ray.
    this.ray.set(source.getOrigin(), source.getDirection());
    if (!this.plane.intersectsRay(this.ray, this.point)) return;
    this.cameraEntity.camera!.worldToScreen(this.point, this.screen);
    const rect = this.handle.app.graphicsDevice.clientRect;
    const next = { x: Math.max(0, Math.min(512, this.screen.x / rect.width * 512)), y: Math.max(0, Math.min(512, this.screen.y / rect.height * 512)) };
    const path = this.gesture.points, last = path.at(-1);
    if (last && Math.hypot(last.x - next.x, last.y - next.y) < 1) return;
    path.push(next); this.drawLine(path);
  }
  private drawLine(path: Point[]) {
    this.clearLine();
    let outline = path;
    if (this.shape === "rectangle") {
      const a = path[0]!, b = path.at(-1)!;
      outline = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
    } else if (this.shape === "lasso" && path.length > 1) outline = [...path, path[0]!];
    if (outline.length < 2) return;
    const positions = new Float32Array(outline.length * 3), rect = this.handle.app.graphicsDevice.clientRect;
    outline.forEach((point, i) => {
      this.cameraEntity.camera!.screenToWorld(point.x / 512 * rect.width, point.y / 512 * rect.height, this.gesture!.depth, this.inverse);
      positions.set(this.inverse.toArray(), i * 3);
    });
    this.line = new WideLine().set(positions, this.strokeColor, 3); this.lines.add(this.line);
  }
  async end() {
    await this.starting;
    const gesture = this.gesture; this.gesture = null; this.clearLine();
    if (!gesture || gesture.points.length === 0) return;
    const camera = this.cameraEntity.camera!, token = this.revision;
    const region = rasterizeGesture(this.shape, gesture.points, 512, 512, gesture.diameter);
    const view = { projectionMatrix: camera.projectionMatrix.clone(), viewMatrix: camera.viewMatrix.clone() };
    this.busy = true; this.changed();
    try {
      const hits = this.xray ? undefined : await this.selection.hitTest(this.handle.app, camera, region);
      if (!this.disposed && token === this.revision && this.workspaces.current === gesture.document)
        this.workspaces.history.perform(() => this.selection.select(region, "add", view, hits));
    } catch (error) { this.message = String(error); }
    finally { this.busy = false; this.input.invalidate(); if (!this.disposed) this.commit(); }
  }
  cancelGesture() { this.dragging = false; this.revision++; this.gesture = null; this.clearLine(); }
  private clearLine() { if (this.line) { this.lines.remove(this.line); this.line = null; } }
  destroy() { this.disposed = true; this.revision++; this.selection.previewArea(null); this.clearLine(); this.lines.destroy(); this.cameraEntity.destroy(); this.tooltip.destroy(); this.tooltipRoot.destroy(); }
}
