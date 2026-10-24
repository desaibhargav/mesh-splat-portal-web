declare module "playcanvas/scripts/esm/camera-controls.mjs" {
  import { Script, Vec2, Vec3, Pose, InputController } from "playcanvas";

  export class CameraControls extends Script {
    update(dt: number): void;
    enableFly: boolean;
    focusDamping: number;
    moveDamping: number;
    rotateDamping: number;
    zoomDamping: number;
    focusPoint: Vec3;
    zoomRange: Vec2;
    protected _pose: Pose;
    protected _controller: InputController;
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
    protected _hotspotSize: number;
    protected _registerAnnotation(annotation: Annotation): void;
    protected _updateAnnotationPositions(annotation: Annotation, resources: { hotspotDom: HTMLDivElement }, point: import("playcanvas").Vec3): void;
    protected _updateAnnotationRotationAndScale(annotation: Annotation, depth: number): void;
    protected _activeAnnotation: Annotation | null;
    protected _setAnnotationHover(annotation: Annotation, hover: boolean): void;
    protected _showTooltip(annotation: Annotation): void;
    protected _hideTooltip(annotation: Annotation): void;
    initialize(): void;
  }
}

declare module "playcanvas/scripts/esm/xr/xr-controllers.mjs" {
  import { Script } from "playcanvas";
  export class XrControllers extends Script { basePath: string }
}

declare module "playcanvas/scripts/esm/xr/xr-manipulation.mjs" {
  import { Script, Entity } from "playcanvas";
  export class XrManipulation extends Script { target: Entity; scalePivot: string }
}

declare module "playcanvas/scripts/esm/xr/xr-menu.mjs" {
  import { Asset, Entity, Script, Vec2, Vec3 } from "playcanvas";
  export class XrMenu extends Script {
    menuItems: { label: string; eventName?: string }[];
    fontAsset: Asset;
    preferredHand: string;
    toggleButtonIndex: number;
    buttonWidth: number;
    buttonHeight: number;
    fontSize: number;
    menuOffset: Vec3;
    alwaysVisible: boolean;
    followDistance: number;
    followOffset: Vec2;
    readonly isPointerOverMenu: boolean;
    setItemLabel(index: number, text: string): boolean;
    // PlayCanvas 2.21 exposes no public programmatic open/close method.
    _setMenuVisible(visible: boolean): void;
    _menuContainer: Entity | null;
    _menuVisible: boolean;
  }
}
