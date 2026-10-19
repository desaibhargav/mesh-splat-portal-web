import {
  CanvasFont, Color, ELEMENTTYPE_TEXT, Entity, Layer, PROJECTION_ORTHOGRAPHIC, Quat, StandardMaterial, Vec3,
  type CameraComponent
} from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { formatDistance } from "./Measurement";

export interface MeasurementStyle { lineWidth: number; fontSize: number }
export const defaultMeasurementStyle: MeasurementStyle = { lineWidth: 3, fontSize: 16 };

interface SegmentVisual {
  points: readonly Vec3[]; worldPoints: Vec3[]; root: Entity; markers: Entity[]; markerLabels: Entity[];
  line: Entity | null; label: Entity | null; midpoint: Vec3;
}

// The line, markers, and text are PlayCanvas scene entities. The same renderer
// is therefore used by the desktop camera and by each WebXR eye.
export class MeasurementRenderer {
  private readonly root = new Entity("Measurements");
  private readonly layer = new Layer({ name: "Measurements", clearDepthBuffer: true });
  private readonly font: CanvasFont;
  private readonly material = new StandardMaterial();
  private readonly camera: CameraComponent;
  private readonly markerSize: number;
  private readonly gap: number;
  private readonly delta = new Vec3();
  private readonly direction = new Vec3();
  private readonly rotation = new Quat();
  private style = defaultMeasurementStyle;
  private visuals: SegmentVisual[] = [];
  private disposed = false;

  constructor(private readonly handle: SelectionHandle) {
    this.camera = handle.camera();
    const style = getComputedStyle(handle.app.graphicsDevice.canvas);
    this.markerSize = parseFloat(style.getPropertyValue("--measurement-marker-size"));
    this.gap = parseFloat(style.getPropertyValue("--measurement-label-gap"));
    this.material.useLighting = false; this.material.useFog = false;
    this.material.useSkybox = false; this.material.useTonemap = false;
    this.material.diffuse.copy(Color.WHITE); this.material.emissive.copy(Color.WHITE); this.material.update();
    this.font = new CanvasFont(handle.app, { fontName: style.fontFamily, fontSize: 32 });
    this.font.createTextures("0123456789AB .,-");
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
      if (this.visuals[i]?.points === points) return;
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
      (this.camera.projectionMatrix.data[5]! * this.handle.app.graphicsDevice.clientRect.height);
  }

  private billboard(entity: Entity, point: Vec3, offset = 0) {
    const depth = this.delta.sub2(point, this.camera.entity.getPosition()).dot(this.camera.entity.forward);
    entity.enabled = depth >= this.camera.nearClip && depth <= this.camera.farClip;
    if (!entity.enabled) return;
    const scale = this.pixelScale(point);
    entity.setPosition(this.delta.copy(this.camera.entity.up).mulScalar(offset * scale).add(point));
    entity.setRotation(this.camera.entity.getRotation()); entity.setLocalScale(scale, scale, scale);
  }

  private update() {
    for (const visual of this.visuals) {
      visual.points.forEach((point, i) => this.handle.space.toWorld(point, visual.worldPoints[i]!));
      visual.markers.forEach((marker, i) => this.billboard(marker, visual.worldPoints[i]!));
      if (!visual.line || !visual.label) continue;
      visual.midpoint.lerp(visual.worldPoints[0]!, visual.worldPoints[1]!, 0.5);
      this.billboard(visual.label, visual.midpoint, this.gap);
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
    this.root.destroy(); this.font.destroy(); this.material.destroy(); this.handle.app.scene.layers.remove(this.layer);
    this.camera.layers = this.camera.layers.filter(id => id !== this.layer.id);
  }
}
