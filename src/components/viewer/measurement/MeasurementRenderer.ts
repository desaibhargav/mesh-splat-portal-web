import {
  CanvasFont, Color, ELEMENTTYPE_TEXT, Entity, Layer, LINECAP_ROUND, PROJECTION_ORTHOGRAPHIC, Quat, StandardMaterial, Vec2, Vec3,
  WideLine, WideLineRenderer,
  type AppBase, type CameraComponent
} from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { formatDistance } from "./Measurement";
import { measurementAppearance } from "./measurementAppearance";

import { defaultMeasurementStyle, type MeasurementStyle } from "./measurementStyle";
export { defaultMeasurementStyle, type MeasurementStyle } from "./measurementStyle";

interface SegmentVisual {
  points: readonly Vec3[]; worldPoints: Vec3[]; root: Entity; markers: Entity[]; markerLabels: Entity[];
  line: WideLine | null; xrLine: Entity | null; linePositions: Float32Array | null; label: Entity | null; midpoint: Vec3;
}

interface MeasurementResources { font: CanvasFont; material: StandardMaterial; users: number }
const resources = new WeakMap<AppBase, MeasurementResources>();
function acquireResources(app: AppBase, fontName: string) {
  let shared = resources.get(app);
  if (!shared) {
    const material = new StandardMaterial();
    material.useLighting = false; material.useFog = false;
    material.useSkybox = false; material.useTonemap = false;
    material.diffuse.copy(Color.WHITE); material.emissive.copy(Color.WHITE); material.update();
    const font = new CanvasFont(app, { fontName, fontSize: 32 });
    font.createTextures("0123456789AB .,-");
    shared = { font, material, users: 0 }; resources.set(app, shared);
  }
  shared.users++;
  return shared;
}
function releaseResources(app: AppBase) {
  const shared = resources.get(app)!;
  if (--shared.users === 0) {
    shared.font.destroy(); shared.material.destroy(); resources.delete(app);
  }
}

// The line, markers, and text are PlayCanvas scene entities. The same renderer
// is therefore used by the desktop camera and by each WebXR eye.
export class MeasurementRenderer {
  private readonly root = new Entity("Measurements");
  private readonly layer = new Layer({ name: "Measurements", clearDepthBuffer: true });
  private readonly font: CanvasFont;
  private readonly material: StandardMaterial;
  private readonly lines: WideLineRenderer;
  private readonly camera: CameraComponent;
  private readonly markerSize: number;
  private readonly gap: number;
  private readonly delta = new Vec3();
  private readonly screenStart = new Vec3();
  private readonly screenEnd = new Vec3();
  private readonly normal = new Vec2();
  private readonly labelOffset = new Vec3();
  private readonly segmentDirection = new Vec3();
  private readonly segmentRotation = new Quat();
  private style = defaultMeasurementStyle;
  private visuals: SegmentVisual[] = [];
  private disposed = false;

  constructor(private readonly handle: SelectionHandle) {
    this.camera = handle.camera();
    const appearance = measurementAppearance(handle.app);
    this.markerSize = appearance.markerSize; this.gap = appearance.gap;
    const shared = acquireResources(handle.app, appearance.font);
    this.font = shared.font; this.material = shared.material;
    handle.app.root.addChild(this.root);
    handle.app.scene.layers.push(this.layer);
    this.camera.layers = [...this.camera.layers, this.layer.id];
    this.lines = new WideLineRenderer(handle.app); this.lines.layer = this.layer;
    this.lines.depthTest = false; this.lines.depthWrite = false;
    handle.app.on("prerender", this.update, this);
    handle.app.on("destroy", this.destroy, this);
    handle.app.xr?.on("end", this.attachLayer, this);
  }
  private attachLayer() {
    if (!this.camera.layers.includes(this.layer.id)) this.camera.layers = [...this.camera.layers, this.layer.id];
  }

  private text(parent: Entity, value: string): Entity {
    const entity = new Entity("Measurement text"); parent.addChild(entity);
    entity.addComponent("element", { type: ELEMENTTYPE_TEXT, font: this.font, text: value,
      fontSize: this.style.fontSize, lineHeight: this.style.fontSize, color: Color.WHITE,
      pivot: [0.5, 0.5], alignment: new Vec2(0.5, 0.5), layers: [this.layer.id], useInput: false, enableMarkup: false });
    return entity;
  }

  setStyle(style: MeasurementStyle) {
    this.handle.app.renderNextFrame = true;
    this.style = style;
    for (const visual of this.visuals) {
      visual.line?.setWidths(style.lineWidth);
      for (const text of [...visual.markerLabels, ...(visual.label ? [visual.label] : [])]) {
        text.element!.fontSize = style.fontSize; text.element!.lineHeight = style.fontSize;
      }
    }
  }

  setSegments(segments: readonly (readonly Vec3[])[]) {
    this.handle.app.renderNextFrame = true;
    this.font.updateTextures(segments.filter(points => points.length === 2)
      .map(points => formatDistance(points[0]!.distance(points[1]!))).join(""));
    this.visuals.slice(segments.length).forEach(visual => { if (visual.line) this.lines.remove(visual.line); visual.root.destroy(); });
    this.visuals.length = Math.min(this.visuals.length, segments.length);
    segments.forEach((points, i) => {
      const existing = this.visuals[i];
      if (existing?.points.length === points.length) {
        existing.points = points;
        if (existing.label) existing.label.element!.text = formatDistance(points[0]!.distance(points[1]!));
        return;
      }
      if (this.visuals[i]?.line) this.lines.remove(this.visuals[i].line);
      this.visuals[i]?.root.destroy();
      const root = new Entity("Measurement segment"); this.root.addChild(root);
      const markerLabels: Entity[] = [];
      const markers = points.map((point, index) => {
        const marker = new Entity("Measurement endpoint"); root.addChild(marker); marker.setPosition(point);
        const sphere = new Entity("Measurement marker"); marker.addChild(sphere);
        sphere.addComponent("render", { type: "sphere", material: this.material, layers: [this.layer.id], castShadows: false, receiveShadows: false });
        sphere.setLocalScale(this.markerSize, this.markerSize, this.markerSize);
        const label = this.text(marker, index === 0 ? "A" : "B");
        label.setLocalPosition(this.markerSize, this.markerSize, 0); markerLabels.push(label);
        return marker;
      });
      const midpoint = points.length === 2 ? new Vec3().lerp(points[0]!, points[1]!, 0.5) : points[0]!.clone();
      let line: WideLine | null = null, xrLine: Entity | null = null, label: Entity | null = null;
      let linePositions: Float32Array | null = null;
      if (points.length === 2) {
        linePositions = new Float32Array(6);
        line = new WideLine().set(linePositions, [1, 1, 1, 1, 1, 1], this.style.lineWidth);
        line.cap = LINECAP_ROUND; this.lines.add(line);
        xrLine = new Entity("XR measurement line"); root.addChild(xrLine);
        xrLine.addComponent("render", { type: "cylinder", material: this.material, layers: [this.layer.id],
          castShadows: false, receiveShadows: false });
        xrLine.enabled = false;
        label = this.text(root, formatDistance(points[0]!.distance(points[1]!)));
      }
      this.visuals[i] = { points, worldPoints: points.map(() => new Vec3()), root, markers, markerLabels, line, xrLine, linePositions, label, midpoint };
    });
  }

  private pixelScale(point: Vec3) {
    const depth = this.delta.sub2(point, this.camera.entity.getPosition()).dot(this.camera.entity.forward);
    return 2 * (this.camera.projection === PROJECTION_ORTHOGRAPHIC ? 1 : depth) /
      (this.camera.projectionMatrix.data[5]! * this.handle.app.graphicsDevice.clientRect.height * this.camera.rect.w);
  }

  private billboard(entity: Entity, point: Vec3, offset?: Vec3) {
    const depth = this.delta.sub2(point, this.camera.entity.getPosition()).dot(this.camera.entity.forward);
    entity.enabled = depth >= this.camera.nearClip && depth <= this.camera.farClip;
    if (!entity.enabled) return;
    const scale = this.pixelScale(point);
    entity.setPosition(offset ? this.delta.copy(offset).mulScalar(scale).add(point) : point);
    entity.setRotation(this.camera.entity.getRotation()); entity.setLocalScale(scale, scale, scale);
  }

  private update() {
    const immersive = !!this.handle.app.xr?.active;
    this.lines.enabled = !immersive;
    for (const visual of this.visuals) {
      visual.points.forEach((point, i) => this.handle.space.toWorld(point, visual.worldPoints[i]!));
      visual.markers.forEach((marker, i) => this.billboard(marker, visual.worldPoints[i]!));
      if (!visual.line || !visual.label) continue;
      visual.midpoint.lerp(visual.worldPoints[0]!, visual.worldPoints[1]!, 0.5);
      if (visual.xrLine) {
        const length = this.segmentDirection.sub2(visual.worldPoints[1]!, visual.worldPoints[0]!).length();
        visual.xrLine.enabled = immersive && length > 0;
        if (visual.xrLine.enabled) {
          visual.xrLine.setPosition(visual.midpoint);
          visual.xrLine.setRotation(this.segmentRotation.setFromDirections(Vec3.UP, this.segmentDirection.mulScalar(1 / length)));
          const width = Math.max(.0001, this.style.lineWidth * this.pixelScale(visual.midpoint));
          visual.xrLine.setLocalScale(width, length, width);
        }
      }
      this.camera.worldToScreen(visual.worldPoints[0]!, this.screenStart);
      this.camera.worldToScreen(visual.worldPoints[1]!, this.screenEnd);
      this.normal.set(this.screenEnd.y - this.screenStart.y, this.screenStart.x - this.screenEnd.x);
      if (this.normal.lengthSq() === 0) this.normal.set(0, -1);
      this.normal.normalize();
      if (this.normal.y > 0 || (this.normal.y === 0 && this.normal.x < 0)) this.normal.mulScalar(-1);
      const clearance = this.gap + this.style.lineWidth / 2 +
        Math.abs(this.normal.x) * visual.label.element!.textWidth / 2 + Math.abs(this.normal.y) * this.style.fontSize / 2;
      this.labelOffset.copy(this.camera.entity.right).mulScalar(this.normal.x)
        .add(this.delta.copy(this.camera.entity.up).mulScalar(-this.normal.y)).mulScalar(clearance);
      this.billboard(visual.label, visual.midpoint, this.labelOffset);
      const start = visual.worldPoints[0]!, end = visual.worldPoints[1]!, packed = visual.linePositions!;
      if (packed[0] !== start.x || packed[1] !== start.y || packed[2] !== start.z ||
          packed[3] !== end.x || packed[4] !== end.y || packed[5] !== end.z) {
        packed.set([start.x, start.y, start.z, end.x, end.y, end.z]); visual.line.setPositions(packed);
      }
    }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.handle.app.off("prerender", this.update, this); this.handle.app.off("destroy", this.destroy, this);
    this.handle.app.xr?.off("end", this.attachLayer, this);
    this.lines.destroy(); this.root.destroy(); releaseResources(this.handle.app); this.handle.app.scene.layers.remove(this.layer);
    this.camera.layers = this.camera.layers.filter(id => id !== this.layer.id);
  }
}
