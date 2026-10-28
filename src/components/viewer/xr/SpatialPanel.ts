import { Color, ElementInput, Entity, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, PIXELFORMAT_RGBA8, Plane, Ray, Texture, Vec3,
  type AppBase, type ElementComponent, type ElementSelectEvent, type XrInputSource } from "playcanvas";

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
  private readonly hoverCanvas = document.createElement("canvas");
  private readonly hoverTexture: Texture;
  private readonly hoverEntity = new Entity("XR hovered control");
  private readonly screen = new Entity("Spatial tool screen");
  private readonly plane = new Plane();
  private readonly ray = new Ray();
  private readonly point = new Vec3();
  private readonly widthAxis = new Vec3();
  private readonly heightAxis = new Vec3();
  private readonly normal = new Vec3();
  private readonly relative = new Vec3();
  private readonly offset = new Vec3();
  private readonly dragStart = new Vec3();
  private readonly dragOrigin = new Vec3();
  private readonly dragDelta = new Vec3();
  private moveSource: XrInputSource | null = null;
  private dragging: string | null = null;
  private hovered: string | null = null;
  private pixelHeight = 1;

  constructor(private readonly app: AppBase, name: string, private readonly width: number,
    private readonly position: Vec3, parent: Entity, private readonly redraw: () => void,
    private readonly bottomAnchored = false, priority = 0, private readonly movable = false,
    renderLayer?: number) {
    this.entity = new Entity(name);
    parent.addChild(this.screen);
    this.screen.setLocalPosition(position);
    this.screen.addComponent("screen", { screenSpace: false, referenceResolution: [1000, 1000], priority });
    this.screen.setLocalScale(.0012, .0012, .0012);
    this.screen.addChild(this.entity);
    this.texture = new Texture(app.graphicsDevice, { name, format: PIXELFORMAT_RGBA8, srgb: true, mipmaps: true,
      minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR });
    const layer = renderLayer ?? app.scene.layers.getLayerByName("UI")!.id;
    this.entity.addComponent("element", { type: "image", width, height: 1, pivot: [0, 1],
      anchor: [.5, .5, .5, .5], texture: this.texture, color: Color.WHITE, useInput: true, layers: [layer] });
    this.hoverTexture = new Texture(app.graphicsDevice, { name: `${name} hover`, format: PIXELFORMAT_RGBA8,
      srgb: true, mipmaps: true, minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR });
    this.screen.addChild(this.hoverEntity);
    this.hoverEntity.addComponent("element", { type: "image", width: 1, height: 1, pivot: [0, 1],
      anchor: [.5, .5, .5, .5], texture: this.hoverTexture, color: Color.WHITE, useInput: false, layers: [layer] });
    this.hoverEntity.enabled = false;
    this.entity.element!.on("selectmove", this.move, this);
    this.entity.element!.on("selectenter", this.move, this);
    this.entity.element!.on("selectleave", this.leave, this);
    this.entity.element!.on("selectstart", this.start, this);
    this.entity.element!.on("selectend", this.end, this);
    this.entity.element!.on("click", this.click, this);
    app.xr?.on("update", this.updateHover, this);
    app.xr?.input.on("selectend", this.stopMoving, this);
  }

  begin(height: number) {
    this.pixelHeight = height + (this.movable ? 14 : 0);
    if (!this.moveSource) this.place();
    if (this.canvas.width !== this.width * 2 || this.canvas.height !== this.pixelHeight * 2) {
      this.canvas.width = this.width * 2; this.canvas.height = this.pixelHeight * 2;
    }
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(2, 0, 0, 2, 0, 0);
    this.controls.length = 0;
    this.entity.element!.height = this.pixelHeight;
    return this.context;
  }
  finish() {
    if (this.movable) {
      const y = this.pixelHeight - 14, ctx = this.context;
      ctx.fillStyle = "#252525"; ctx.fillRect(0, y, this.width, 14);
      ctx.fillStyle = this.hovered === "Move panel" ? "#ffe08c" : "#aaa";
      ctx.beginPath(); ctx.roundRect(this.width / 2 - 19, y + 5, 38, 4, 2); ctx.fill();
      this.controls.push({ label: "Move panel", x: 0, y, width: this.width, height: 14 });
    }
    const hovered = this.controls.find(control => control.label === this.hovered);
    if (hovered) {
      const ctx = this.context; ctx.save();
      ctx.fillStyle = "#ffd36e22"; ctx.strokeStyle = "#ffe08c"; ctx.lineWidth = 3;
      ctx.shadowColor = "#ffd36e"; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.roundRect(hovered.x + 1.5, hovered.y + 1.5,
        hovered.width - 3, hovered.height - 3, 3); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    this.texture.resize(this.canvas.width, this.canvas.height);
    this.texture.setSource(this.canvas); this.app.renderNextFrame = true;
    this.hoverEntity.enabled = !!hovered;
    if (hovered) {
      this.hoverCanvas.width = hovered.width * 2; this.hoverCanvas.height = hovered.height * 2;
      this.hoverCanvas.getContext("2d")!.drawImage(this.canvas, hovered.x * 2, hovered.y * 2,
        hovered.width * 2, hovered.height * 2, 0, 0, this.hoverCanvas.width, this.hoverCanvas.height);
      this.hoverTexture.resize(this.hoverCanvas.width, this.hoverCanvas.height);
      this.hoverTexture.setSource(this.hoverCanvas);
      this.hoverEntity.element!.width = hovered.width; this.hoverEntity.element!.height = hovered.height;
      this.hoverEntity.setLocalPosition(hovered.x, -hovered.y, 8);
    }
  }
  get enabled() { return this.screen.enabled; }
  set enabled(value: boolean) { this.screen.enabled = value; if (!value) { this.hovered = this.dragging = null; this.moveSource = null; this.hoverEntity.enabled = false; } }
  get isTargeted() {
    // Engine 2.21 types this as Entity but ElementInput assigns its
    // ElementComponent. Keep that pinned-version mismatch at this boundary.
    return !!this.moveSource || (this.app.xr?.input.inputSources.some(source => source.handedness === "right" &&
      (source.elementEntity as unknown as ElementComponent | null)?.entity === this.entity) ?? false);
  }
  resetPosition() { this.moveSource = null; this.offset.set(0, 0, 0); this.place(); }
  private place() { this.screen.setLocalPosition(this.position.x + this.offset.x,
    this.position.y + (this.bottomAnchored ? this.pixelHeight * .0012 : 0) + this.offset.y,
    this.position.z + this.offset.z); }
  isHovered(label: string) { return this.hovered === label; }

  private coordinates(source: XrInputSource) {
    if (source.handedness !== "right") return null;
    const corners = this.entity.element!.worldCorners;
    this.widthAxis.sub2(corners[1]!, corners[0]!); this.heightAxis.sub2(corners[3]!, corners[0]!);
    this.normal.cross(this.widthAxis, this.heightAxis).normalize();
    this.plane.setFromPointNormal(corners[0]!, this.normal);
    this.ray.set(source.getOrigin(), source.getDirection());
    if (!this.plane.intersectsRay(this.ray, this.point)) return null;
    this.relative.sub2(this.point, corners[0]!);
    return { x: this.relative.dot(this.widthAxis) / this.widthAxis.lengthSq() * this.width,
      y: (1 - this.relative.dot(this.heightAxis) / this.heightAxis.lengthSq()) * this.pixelHeight };
  }
  private hit(source: XrInputSource) {
    const point = this.coordinates(source);
    return point && this.controls.find(control => point.x >= control.x && point.x <= control.x + control.width &&
      point.y >= control.y && point.y <= control.y + control.height);
  }
  private apply(control: PanelControl, event: ElementSelectEvent) {
    const point = this.coordinates(event.inputSource);
    if (point) control.activate?.(Math.min(1, Math.max(0, control.axis === "y" ?
      (point.y - control.y) / control.height : (point.x - control.x) / control.width)));
  }
  private start(event: ElementSelectEvent) {
    if (event.inputSource.handedness !== "right") return;
    const control = this.hit(event.inputSource);
    if (control?.label === "Move panel" && this.movable) {
      this.moveSource = event.inputSource;
      this.dragOrigin.copy(event.inputSource.getPosition() ?? event.inputSource.getOrigin());
      this.dragStart.copy(this.screen.getLocalPosition());
      return;
    }
    if (control?.drag) { this.dragging = control.label; this.apply(control, event); }
  }
  private move(event: ElementSelectEvent) {
    if (event.inputSource.handedness !== "right") return;
    if (this.dragging) {
      const control = this.controls.find(item => item.label === this.dragging);
      if (control) this.apply(control, event);
    }
    const hovered = this.hit(event.inputSource)?.label ?? null;
    if (hovered !== this.hovered) { this.hovered = hovered; this.redraw(); }
  }
  private end(event: ElementSelectEvent) { if (event.inputSource.handedness === "right") this.dragging = null; }
  private click(event: ElementSelectEvent) {
    if (event.inputSource.handedness !== "right") return;
    const control = this.hit(event.inputSource);
    if (control && !control.drag) this.apply(control, event);
  }
  private leave(event: ElementSelectEvent) { if (event.inputSource.handedness !== "right") return; if (this.hovered) { this.hovered = null; this.redraw(); } }
  private updateHover() {
    if (!this.enabled) return;
    if (this.moveSource) {
      this.dragDelta.sub2(this.moveSource.getPosition() ?? this.moveSource.getOrigin(), this.dragOrigin);
      this.screen.parent!.getWorldTransform().clone().invert().transformVector(this.dragDelta, this.dragDelta);
      this.screen.setLocalPosition(this.dragStart.clone().add(this.dragDelta));
      this.offset.sub2(this.screen.getLocalPosition(), this.position);
      if (this.bottomAnchored) this.offset.y -= this.pixelHeight * .0012;
      this.app.renderNextFrame = true;
      return;
    }
    const source = this.app.xr?.input.inputSources.find(source => source.handedness === "right");
    const hovered = source && (source.elementEntity as unknown as ElementComponent | null)?.entity === this.entity ?
      this.hit(source)?.label ?? null : null;
    if (hovered !== this.hovered) { this.hovered = hovered; this.redraw(); }
  }
  private stopMoving(source: XrInputSource) { if (source === this.moveSource) this.moveSource = null; }
  destroy() { this.app.xr?.off("update", this.updateHover, this); this.app.xr?.input.off("selectend", this.stopMoving, this);
    this.screen.destroy(); this.texture.destroy(); this.hoverTexture.destroy(); }
}

// @playcanvas/react does not install ElementInput. Own it only for this session,
// leaving a pre-existing application input manager untouched.
export function spatialInput(app: AppBase) {
  if (app.elementInput) return () => {};
  const input = new ElementInput(app.graphicsDevice.canvas, { useMouse: false, useTouch: false, useXr: true });
  app.elementInput = input; input.app = app; input.attachSelectEvents();
  return () => { input.detach(); if (app.elementInput === input) app.elementInput = null; };
}
