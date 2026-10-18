import { CanvasFont, Color, ELEMENTTYPE_IMAGE, ELEMENTTYPE_TEXT, Entity, Layer, PROJECTION_ORTHOGRAPHIC, StandardMaterial, Vec3, type CameraComponent } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { formatDistance } from "./Measurement";

interface SegmentVisual {
  points: readonly Vec3[]; root: Entity; markers: Entity[]; label: Entity | null; midpoint: Vec3;
}

// One scene renderer for both asset types and desktop/XR cameras. PlayCanvas
// supplies text layout, font atlases, line batching, and per-eye rendering.
export class MeasurementRenderer {
  private readonly root = new Entity("Measurements");
  private readonly layer = new Layer({ name: "Measurement labels", clearDepthBuffer: true });
  private readonly font: CanvasFont;
  private readonly markerMaterial = new StandardMaterial();
  private readonly camera: CameraComponent;
  private readonly gold: Color;
  private readonly background: Color;
  private readonly textColor: Color;
  private readonly fontSize: number;
  private readonly markerSize: number;
  private readonly gap: number;
  private readonly padding: number;
  private readonly delta = new Vec3();
  private visuals: SegmentVisual[] = [];
  private disposed = false;

  constructor(private readonly handle: SelectionHandle) {
    this.camera = handle.camera();
    const style = getComputedStyle(handle.app.graphicsDevice.canvas);
    this.fontSize = parseFloat(style.getPropertyValue("--measurement-font-size"));
    this.markerSize = parseFloat(style.getPropertyValue("--measurement-marker-size"));
    this.gap = parseFloat(style.getPropertyValue("--measurement-label-gap"));
    this.padding = parseFloat(style.getPropertyValue("--measurement-label-padding"));
    this.gold = new Color().fromString(style.getPropertyValue("--gold").trim());
    this.background = new Color().fromString(style.getPropertyValue("--measurement-label-background").trim());
    this.textColor = new Color().fromString(style.getPropertyValue("--measurement-label-color").trim());
    this.markerMaterial.useLighting = false; this.markerMaterial.useFog = false;
    this.markerMaterial.useSkybox = false; this.markerMaterial.useTonemap = false;
    this.markerMaterial.diffuse.set(0, 0, 0); this.markerMaterial.emissive.copy(this.gold); this.markerMaterial.update();
    this.font = new CanvasFont(handle.app, { fontName: style.fontFamily, fontSize: 32 });
    this.font.createTextures("0123456789AB .,-model units");
    handle.app.root.addChild(this.root);
    handle.app.scene.layers.push(this.layer);
    this.camera.layers = [...this.camera.layers, this.layer.id];
    handle.app.on("prerender", this.update, this);
    handle.app.on("destroy", this.destroy, this);
  }

  private text(parent: Entity, value: string, size: number, color: Color): Entity {
    const entity = new Entity("Measurement text"); parent.addChild(entity);
    entity.addComponent("element", { type: ELEMENTTYPE_TEXT, font: this.font, text: value, fontSize: size, lineHeight: size,
      color, pivot: [0.5, 0.5], alignment: [0.5, 0.5], layers: [this.layer.id], useInput: false, enableMarkup: false });
    return entity;
  }

  setSegments(segments: readonly (readonly Vec3[])[]) {
    this.font.updateTextures(segments.filter(points => points.length === 2)
      .map(points => `${formatDistance(points[0]!.distance(points[1]!))} model units`).join(""));
    this.visuals.slice(segments.length).forEach(visual => visual.root.destroy());
    this.visuals.length = Math.min(this.visuals.length, segments.length);
    segments.forEach((points, i) => {
      if (this.visuals[i]?.points === points) return;
      this.visuals[i]?.root.destroy();
      const root = new Entity("Measurement segment"); this.root.addChild(root);
      const markers = points.map((point, index) => {
        const marker = new Entity("Measurement endpoint"); root.addChild(marker); marker.setPosition(point);
        const sphere = new Entity("Measurement marker"); marker.addChild(sphere);
        sphere.addComponent("render", { type: "sphere", material: this.markerMaterial, layers: [this.layer.id], castShadows: false, receiveShadows: false });
        sphere.setLocalScale(this.markerSize, this.markerSize, this.markerSize);
        this.text(marker, index === 0 ? "A" : "B", this.fontSize, this.textColor).setLocalPosition(this.markerSize, this.markerSize, 0);
        return marker;
      });
      const midpoint = points.length === 2 ? new Vec3().lerp(points[0]!, points[1]!, 0.5) : points[0]!.clone();
      let label: Entity | null = null;
      if (points.length === 2) {
        label = new Entity("Measurement distance"); root.addChild(label);
        const text = this.text(label, `${formatDistance(points[0]!.distance(points[1]!))} model units`, this.fontSize, this.textColor);
        const background = new Entity("Measurement label background"); label.addChild(background);
        background.addComponent("element", { type: ELEMENTTYPE_IMAGE, color: this.background,
          width: text.element!.width + this.padding * 2, height: text.element!.height + this.padding * 2,
          pivot: [0.5, 0.5], layers: [this.layer.id], useInput: false });
        background.setLocalPosition(0, 0, -this.padding);
      }
      this.visuals[i] = { points, root, markers, label, midpoint };
    });
  }

  private billboard(entity: Entity, point: Vec3, offset = 0) {
    const camera = this.camera;
    const depth = this.delta.sub2(point, camera.entity.getPosition()).dot(camera.entity.forward);
    entity.enabled = depth >= camera.nearClip && depth <= camera.farClip;
    if (!entity.enabled) return;
    // Projection handles perspective, orthographic, horizontal FOV, and XR camera
    // properties. Scale in world units; the engine projects each eye independently.
    const scale = 2 * (camera.projection === PROJECTION_ORTHOGRAPHIC ? 1 : depth) / (camera.projectionMatrix.data[5]! * this.handle.app.graphicsDevice.clientRect.height);
    entity.setPosition(this.delta.copy(camera.entity.up).mulScalar(offset * scale).add(point));
    entity.setRotation(camera.entity.getRotation()); entity.setLocalScale(scale, scale, scale);
  }

  private update() {
    for (const visual of this.visuals) {
      visual.markers.forEach((marker, i) => this.billboard(marker, visual.points[i]!));
      if (visual.label) {
        this.billboard(visual.label, visual.midpoint, this.gap);
        this.handle.app.scene.drawLine(visual.points[0]!, visual.points[1]!, this.gold, false);
      }
    }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.handle.app.off("prerender", this.update, this); this.handle.app.off("destroy", this.destroy, this);
    this.root.destroy(); this.font.destroy(); this.markerMaterial.destroy(); this.handle.app.scene.layers.remove(this.layer);
    this.camera.layers = this.camera.layers.filter(id => id !== this.layer.id);
  }
}
