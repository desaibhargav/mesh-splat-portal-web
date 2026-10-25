import { Color, ElementInput, Entity, FILTER_LINEAR, PIXELFORMAT_RGBA8, Plane, Ray, Texture, Vec3,
  type AppBase, type ElementComponent, type ElementSelectEvent } from "playcanvas";

export interface PanelControl {
  label: string; x: number; y: number; width: number; height: number;
  activate?(fraction: number): void; drag?: boolean; axis?: "x" | "y";
}

// A small presentation adapter: native PlayCanvas screens and ElementInput own
// stereo rendering and controller targeting. Canvas preserves the portal's
// fonts, vector icons and control styling without a second UI framework.
// Textures upload only after an edit/hover change, never in the render loop.
export class SpatialPanel {
  readonly entity: Entity;
  readonly canvas = document.createElement("canvas");
  readonly context = this.canvas.getContext("2d")!;
  readonly controls: PanelControl[] = [];
  private readonly texture: Texture;
  private readonly screen = new Entity("Spatial tool screen");
  private readonly plane = new Plane();
  private readonly ray = new Ray();
  private readonly point = new Vec3();
  private readonly widthAxis = new Vec3();
  private readonly heightAxis = new Vec3();
  private readonly normal = new Vec3();
  private readonly relative = new Vec3();
  private dragging: string | null = null;
  private hovered: string | null = null;
  private pixelHeight = 1;

  constructor(private readonly app: AppBase, name: string, private readonly width: number,
    private readonly position: Vec3, parent: Entity, private readonly redraw: () => void,
    private readonly bottomAnchored = false, priority = 0) {
    this.entity = new Entity(name);
    parent.addChild(this.screen);
    this.screen.setLocalPosition(position);
    this.screen.addComponent("screen", { screenSpace: false, referenceResolution: [1000, 1000], priority });
    this.screen.setLocalScale(.0012, .0012, .0012);
    this.screen.addChild(this.entity);
    this.texture = new Texture(app.graphicsDevice, { name, format: PIXELFORMAT_RGBA8, srgb: true, mipmaps: false,
      minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR });
    const layer = app.scene.layers.getLayerByName("UI")!.id;
    this.entity.addComponent("element", { type: "image", width, height: 1, pivot: [0, 1],
      anchor: [.5, .5, .5, .5], texture: this.texture, color: Color.WHITE, useInput: true, layers: [layer] });
    this.entity.element!.on("selectmove", this.move, this);
    this.entity.element!.on("selectenter", this.move, this);
    this.entity.element!.on("selectleave", this.leave, this);
    this.entity.element!.on("selectstart", this.start, this);
    this.entity.element!.on("selectend", this.end, this);
    this.entity.element!.on("click", this.click, this);
  }

  begin(height: number) {
    this.pixelHeight = height;
    if (this.bottomAnchored) this.screen.setLocalPosition(this.position.x, this.position.y + height * .0012, this.position.z);
    if (this.canvas.width !== this.width * 2 || this.canvas.height !== height * 2) {
      this.canvas.width = this.width * 2; this.canvas.height = height * 2;
    }
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(2, 0, 0, 2, 0, 0);
    this.controls.length = 0;
    this.entity.element!.height = height;
    return this.context;
  }
  finish() {
    const hovered = this.controls.find(control => control.label === this.hovered);
    if (hovered) {
      const ctx = this.context; ctx.save(); ctx.strokeStyle = "#dbc17b"; ctx.lineWidth = 2;
      ctx.shadowColor = "#dbc17b"; ctx.shadowBlur = 6;
      ctx.strokeRect(hovered.x + 1, hovered.y + 1, hovered.width - 2, hovered.height - 2); ctx.restore();
    }
    this.texture.resize(this.canvas.width, this.canvas.height);
    this.texture.setSource(this.canvas); this.app.renderNextFrame = true;
  }
  get enabled() { return this.screen.enabled; }
  set enabled(value: boolean) { this.screen.enabled = value; if (!value) this.hovered = this.dragging = null; }
  get isTargeted() {
    // Engine 2.21 types this as Entity but ElementInput assigns its
    // ElementComponent. Keep that pinned-version mismatch at this boundary.
    return this.app.xr?.input.inputSources.some(source => source.handedness === "right" &&
      (source.elementEntity as unknown as ElementComponent | null)?.entity === this.entity) ?? false;
  }
  isHovered(label: string) { return this.hovered === label; }

  private coordinates(event: ElementSelectEvent) {
    if (event.inputSource.handedness !== "right") return null;
    const corners = this.entity.element!.worldCorners;
    this.widthAxis.sub2(corners[1]!, corners[0]!); this.heightAxis.sub2(corners[3]!, corners[0]!);
    this.normal.cross(this.widthAxis, this.heightAxis).normalize();
    this.plane.setFromPointNormal(corners[0]!, this.normal);
    this.ray.set(event.inputSource.getOrigin(), event.inputSource.getDirection());
    if (!this.plane.intersectsRay(this.ray, this.point)) return null;
    this.relative.sub2(this.point, corners[0]!);
    return { x: this.relative.dot(this.widthAxis) / this.widthAxis.lengthSq() * this.width,
      y: (1 - this.relative.dot(this.heightAxis) / this.heightAxis.lengthSq()) * this.pixelHeight };
  }
  private hit(event: ElementSelectEvent) {
    const point = this.coordinates(event);
    return point && this.controls.find(control => point.x >= control.x && point.x <= control.x + control.width &&
      point.y >= control.y && point.y <= control.y + control.height);
  }
  private apply(control: PanelControl, event: ElementSelectEvent) {
    const point = this.coordinates(event);
    if (point) control.activate?.(Math.min(1, Math.max(0, control.axis === "y" ?
      (point.y - control.y) / control.height : (point.x - control.x) / control.width)));
  }
  private start(event: ElementSelectEvent) {
    if (event.inputSource.handedness !== "right") return;
    const control = this.hit(event);
    if (control?.drag) { this.dragging = control.label; this.apply(control, event); }
  }
  private move(event: ElementSelectEvent) {
    if (event.inputSource.handedness !== "right") return;
    if (this.dragging) {
      const control = this.controls.find(item => item.label === this.dragging);
      if (control) this.apply(control, event);
    }
    const hovered = this.hit(event)?.label ?? null;
    if (hovered !== this.hovered) { this.hovered = hovered; this.redraw(); }
  }
  private end(event: ElementSelectEvent) { if (event.inputSource.handedness === "right") this.dragging = null; }
  private click(event: ElementSelectEvent) {
    if (event.inputSource.handedness !== "right") return;
    const control = this.hit(event);
    if (control && !control.drag) this.apply(control, event);
  }
  private leave(event: ElementSelectEvent) { if (event.inputSource.handedness !== "right") return; if (this.hovered) { this.hovered = null; this.redraw(); } }
  destroy() { this.screen.destroy(); this.texture.destroy(); }
}

// @playcanvas/react does not install ElementInput. Own it only for this session,
// leaving a pre-existing application input manager untouched.
export function spatialInput(app: AppBase) {
  if (app.elementInput) return () => {};
  const input = new ElementInput(app.graphicsDevice.canvas, { useMouse: false, useTouch: false, useXr: true });
  app.elementInput = input; input.app = app; input.attachSelectEvents();
  return () => { input.detach(); if (app.elementInput === input) app.elementInput = null; };
}
