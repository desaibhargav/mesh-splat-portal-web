import { Color, Entity, PROJECTION_ORTHOGRAPHIC, Vec3 } from "playcanvas";
import { Annotation, AnnotationManager } from "playcanvas/scripts/esm/annotations.mjs";

// Confine the engine example's DOM to the canvas, including embedded/fullscreen
// layouts. All hotspot rendering, tooltip text, and interaction remain upstream.
export class ViewerAnnotationManager extends AnnotationManager {
  static scriptName = "viewerAnnotationManager";
  container!: HTMLElement;
  viewCamera!: Entity;
  shades = new Map<Annotation, Color>();
  regionAnnotation: Annotation | null = null;
  private readonly parentScale = new Vec3();
  _setAnnotationHover(annotation: Annotation, hover: boolean) {
    super._setAnnotationHover(annotation, hover);
    const color = hover ? this.hoverColor : this.shades.get(annotation) ?? this.hotspotColor;
    for (const material of this._annotationResources.get(annotation)?.materials ?? []) {
      material.emissive.copy(color);
      material.update();
    }
  }
  showRegion(annotation: Annotation | null) {
    if (this.regionAnnotation === annotation) return;
    if (this.regionAnnotation && this._activeAnnotation === this.regionAnnotation) this._hideTooltip(this.regionAnnotation);
    this.regionAnnotation = annotation;
    if (annotation) this._showTooltip(annotation);
  }
  hotspot(annotation: Annotation) {
    return (this._annotationResources as unknown as Map<Annotation, { hotspotDom: HTMLDivElement }>).get(annotation)?.hotspotDom;
  }
  // Each native manager owns only its viewport's scene-visual replicas.
  protected override _registerAnnotation(annotation: Annotation) {
    if (annotation.entity.parent === this.entity) super._registerAnnotation(annotation);
  }
  protected override _updateAnnotationPositions(annotation: Annotation, resources: { hotspotDom: HTMLDivElement }, point: Vec3) {
    const camera = this.viewCamera.camera!, { width, height } = this.app.graphicsDevice.clientRect;
    point.x -= camera.rect.x * width; point.y -= (1 - camera.rect.y - camera.rect.w) * height;
    super._updateAnnotationPositions(annotation, resources, point);
  }
  protected override _updateAnnotationRotationAndScale(annotation: Annotation, depth: number) {
    const camera = this.viewCamera.camera!;
    annotation.entity.setRotation(this.viewCamera.getRotation()); annotation.entity.rotateLocal(90, 0, 0);
    const height = this.app.graphicsDevice.clientRect.height * camera.rect.w;
    const size = this.app.xr?.active ? .018 : this._hotspotSize * 2 * (camera.projection === PROJECTION_ORTHOGRAPHIC ? 1 : depth) / (height * camera.projectionMatrix.data[5]!);
    annotation.entity.parent!.getWorldTransform().getScale(this.parentScale);
    annotation.entity.setLocalScale(size / this.parentScale.x, size / this.parentScale.y, size / this.parentScale.z);
  }
  initialize() {
    this._parentDom = this.container; this._camera = this.viewCamera;
    super.initialize();
    // MeshInstance destroys an unreferenced mesh. The manager must retain its
    // shared plane across draft replacement and deletion of the last marker.
    const mesh = this._mesh!;
    mesh.incRefCount();
    this.once("destroy", () => mesh.decRefCount());
  }
}
