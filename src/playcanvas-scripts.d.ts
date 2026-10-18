declare module "playcanvas/scripts/esm/camera-controls.mjs" {
  import { Script, Vec2, Vec3 } from "playcanvas";

  export class CameraControls extends Script {
    focusPoint: Vec3;
    zoomRange: Vec2;
  }
}

declare module "playcanvas/scripts/esm/annotations.mjs" {
  import { Script, Entity, Color, Mesh, StandardMaterial } from "playcanvas";

  export class Annotation extends Script {
    label: string;
    title: string;
    text: string;
  }
  export class AnnotationManager extends Script {
    hotspotColor: Color;
    hoverColor: Color;
    // The pinned engine script assumes a full-page canvas. Our small adapter
    // supplies its DOM container and camera before the base initializer runs.
    protected _parentDom: HTMLElement | null;
    protected _camera: Entity | null;
    protected _mesh: Mesh | null;
    protected _annotationResources: Map<Annotation, { materials: StandardMaterial[] }>;
    protected _activeAnnotation: Annotation | null;
    protected _setAnnotationHover(annotation: Annotation, hover: boolean): void;
    protected _showTooltip(annotation: Annotation): void;
    protected _hideTooltip(annotation: Annotation): void;
    initialize(): void;
  }
}
