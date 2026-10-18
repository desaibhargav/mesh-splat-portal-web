import { Color, Entity } from "playcanvas";
import { Annotation, AnnotationManager } from "playcanvas/scripts/esm/annotations.mjs";

// Confine the engine example's DOM to the canvas, including embedded/fullscreen
// layouts. All hotspot rendering, tooltip text, and interaction remain upstream.
export class ViewerAnnotationManager extends AnnotationManager {
  static scriptName = "viewerAnnotationManager";
  container!: HTMLElement;
  viewCamera!: Entity;
  shades = new Map<Annotation, Color>();
  regionAnnotation: Annotation | null = null;
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
