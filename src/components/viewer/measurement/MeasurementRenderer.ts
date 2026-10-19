import {
  CanvasFont, Color, ELEMENTTYPE_TEXT, Entity, Layer, PROJECTION_ORTHOGRAPHIC, Quat, StandardMaterial, Vec2, Vec3,
  type AppBase, type CameraComponent
} from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { formatDistance } from "./Measurement";

export interface MeasurementStyle { lineWidth: number; fontSize: number }
export const defaultMeasurementStyle: MeasurementStyle = { lineWidth: 3, fontSize: 16 };

interface SegmentVisual {
  points: readonly Vec3[]; worldPoints: Vec3[]; root: Entity; markers: Entity[]; markerLabels: Entity[];
  line: Entity | null; label: Entity | null; midpoint: Vec3;
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
  private readonly camera: CameraComponent;
  private readonly markerSize: number;
  private readonly gap: number;
  private readonly delta = new Vec3();
  private readonly direction = new Vec3();
  private readonly screenStart = new Vec3();
  private readonly screenEnd = new Vec3();
  private readonly normal = new Vec2();
  private readonly labelOffset = new Vec3();
  private readonly rotation = new Quat();
  private style = defaultMeasurementStyle;
  private visuals: SegmentVisual[] = [];
  private disposed = false;

  constructor(private readonly handle: SelectionHandle) {
    this.camera = handle.camera();
    const style = getComputedStyle(handle.app.graphicsDevice.canvas);
    this.markerSize = parseFloat(style.getPropertyValue("--measurement-marker-size"));
    this.gap = parseFloat(style.getPropertyValue("--measurement-label-gap"));
    const shared = acquireResources(handle.app, style.fontFamily);
    this.font = shared.font; this.material = shared.material;
    handle.app.root.addChild(this.root);
    handle.app.scene.layers.push(this.layer);
    this.camera.layers = [...this.camera.layers, this.layer.id];
    handle.app.on("prerender", this.update, this);
    handle.app.on("destroy", this.destroy, this);
  }

  private text(parent: Entity, value: string): Entity {
    const entity = new Entity("Measurement text"); parent.addChild(entity);
    entity.addComponent("element", { type: ELEMENTTYPE_TEXT, font: this.font, text: value,
      fontSize: this.style.fontSize, lineHeight: this.style.fontSize, color: Color.WHITE,
      pivot: [0.5, 0.5], alignment: [0.5, 0.5], layers: [this.layer.id], useInput: false, enableMarkup: false });
    return entity;
  }

  setStyle(style: MeasurementStyle) {
    this.style = style;
    for (const visual of this.visuals) {
      for (const text of [...visual.markerLabels, ...(visual.label ? [visual.label] : [])]) {
        text.element!.fontSize = style.fontSize; text.element!.lineHeight = style.fontSize;
      }
    }
  }

  setSegments(segments: readonly (readonly Vec3[])[]) {
    this.font.updateTextures(segments.filter(points => points.length === 2)
      .map(points => formatDistance(points[0]!.distance(points[1]!))).join(""));
    this.visuals.slice(segments.length).forEach(visual => visual.root.destroy());
    this.visuals.length = Math.min(this.visuals.length, segments.length);
    segments.forEach((points, i) => {
      const existing = this.visuals[i];
      if (existing?.points.length === points.length) {
        existing.points = points;
        if (existing.label) existing.label.element!.text = formatDistance(points[0]!.distance(points[1]!));
        return;
      }
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
      let line: Entity | null = null, label: Entity | null = null;
      if (points.length === 2) {
        line = new Entity("Measurement line"); root.addChild(line);
        line.addComponent("render", { type: "cylinder", material: this.material, layers: [this.layer.id], castShadows: false, receiveShadows: false });
        label = this.text(root, formatDistance(points[0]!.distance(points[1]!)));
      }
      this.visuals[i] = { points, worldPoints: points.map(() => new Vec3()), root, markers, markerLabels, line, label, midpoint };
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
    for (const visual of this.visuals) {
      visual.points.forEach((point, i) => this.handle.space.toWorld(point, visual.worldPoints[i]!));
      visual.markers.forEach((marker, i) => this.billboard(marker, visual.worldPoints[i]!));
      if (!visual.line || !visual.label) continue;
      visual.midpoint.lerp(visual.worldPoints[0]!, visual.worldPoints[1]!, 0.5);
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
      const length = this.direction.sub2(visual.worldPoints[1]!, visual.worldPoints[0]!).length();
      visual.line.enabled = length > 0;
      if (!visual.line.enabled) continue;
      visual.line.setPosition(visual.midpoint);
      visual.line.setRotation(this.rotation.setFromDirections(Vec3.UP, this.direction.mulScalar(1 / length)));
      const width = this.pixelScale(visual.midpoint) * this.style.lineWidth;
      visual.line.setLocalScale(width, length, width);
    }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.handle.app.off("prerender", this.update, this); this.handle.app.off("destroy", this.destroy, this);
    this.root.destroy(); releaseResources(this.handle.app); this.handle.app.scene.layers.remove(this.layer);
    this.camera.layers = this.camera.layers.filter(id => id !== this.layer.id);
  }
}
