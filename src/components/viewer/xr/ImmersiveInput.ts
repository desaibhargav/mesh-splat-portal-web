import { Color, Entity, Layer, Mat4, Plane, Quat, Ray, StandardMaterial, Vec3, WideLine, WideLineRenderer, type AppBase, type ElementComponent, type XrInputSource } from "playcanvas";
import { XrControllers } from "playcanvas/scripts/esm/xr/xr-controllers.mjs";
import { XrManipulation } from "playcanvas/scripts/esm/xr/xr-manipulation.mjs";

import type { SelectionHandle, SurfaceHit } from "../selection/types";

const profiles = "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles";
const rayLength = 1.5;
const controllerModels = new WeakMap<AppBase, Entity>();

// The native loader owns a URL cache across sessions. Keep its owner alive for
// the viewer, so ending one session cannot unload a model another is loading.
function ensureControllerModels(app: AppBase) {
  if (controllerModels.has(app)) return;
  const owner = new Entity("XR controller models");
  app.root.addChild(owner); owner.addComponent("script");
  owner.script!.create(XrControllers, { properties: { basePath: profiles } });
  controllerModels.set(app, owner);
  app.once("destroy", () => { controllerModels.delete(app); owner.destroy(); });
}

// Native scripts own model loading and the two-handed manipulation algorithm.
// This adapter adds only pointer visuals and full-pose, one-controller grabbing.
export class ImmersiveInput {
  private readonly rays: WideLineRenderer;
  private readonly rayLayer = new Layer({ name: "XR pointer rays" });
  private readonly releaseRayLayer: () => void;
  private readonly pointers = new Map<XrInputSource, { line: WideLine; positions: Float32Array; tip: Entity }>();
  private readonly tipMaterial = new StandardMaterial();
  private readonly hits = new Map<XrInputSource, { origin: Vec3; direction: Vec3; transform: Mat4;
    hit: SurfaceHit | null; pending: boolean; time: number; revision: number }>();
  private readonly plane = new Plane();
  private readonly ray = new Ray();
  private readonly uiPoint = new Vec3();
  private readonly normal = new Vec3();
  private readonly edge = new Vec3();
  private disposed = false;
  private revision = 0;
  private grabbing: XrInputSource | null = null;
  private readonly inverseGrip = new Mat4();
  private readonly initial = new Mat4();
  private readonly pose = new Mat4();
  private readonly result = new Mat4();
  private readonly position = new Vec3();
  private readonly rotation = new Quat();
  private readonly scale = new Vec3();
  private readonly end = new Vec3();
  private extraTarget: ((source: XrInputSource) => Vec3 | null) | null = null;
  private needNormal = false;

  constructor(private readonly app: AppBase, private readonly rig: Entity, private readonly target: Entity, private readonly handle: SelectionHandle) {
    app.scene.layers.push(this.rayLayer);
    this.releaseRayLayer = handle.viewports.shareLayer(this.rayLayer.id);
    this.rays = new WideLineRenderer(app); this.rays.layer = this.rayLayer;
    this.rays.depthTest = false; this.rays.depthWrite = false;
    this.tipMaterial.useLighting = this.tipMaterial.useFog = this.tipMaterial.useTonemap = false;
    this.tipMaterial.useSkybox = false; this.tipMaterial.emissive = new Color(1, 1, 1);
    this.tipMaterial.depthTest = this.tipMaterial.depthWrite = false; this.tipMaterial.update();
    app.on("xr:controller:add", this.nameModel, this);
    app.xr!.input.on("remove", this.remove, this);
    rig.addComponent("script");
    ensureControllerModels(app);
    rig.script!.create(XrManipulation, { properties: { target, scalePivot: "hands", enableScale: false } });
    app.on("update", this.update, this);
    app.on("prerender", this.drawRays, this);
  }

  private nameModel(source: XrInputSource, entity: Entity) { entity.name = `XR controller ${source.handedness}`; }

  private update() {
    if (!this.app.xr?.active) return;
    let held: XrInputSource | null = null, count = 0;
    for (const source of this.app.xr.input.inputSources) {
      if (!source.grip || source.hand) continue;
      if (source.squeezing) { held = source; count++; }
    }
    // Two grips belong entirely to XrManipulation. Re-anchor on every transition
    // between one and two controllers so neither solver introduces a jump.
    if (count !== 1 || !held) { this.grabbing = null; return; }
    this.pose.setTRS(held.getPosition()!, held.getRotation()!, Vec3.ONE);
    if (held !== this.grabbing) {
      this.grabbing = held; this.inverseGrip.invert(this.pose); this.initial.copy(this.target.getWorldTransform());
      return;
    }
    this.result.mul2(this.pose, this.inverseGrip).mul(this.initial);
    this.target.setPosition(this.result.getTranslation(this.position));
    this.target.setRotation(this.rotation.setFromMat4(this.result));
    this.target.setLocalScale(this.result.getScale(this.scale));
  }

  invalidate() { this.revision++; }
  setNormalPicking(value: boolean) { if (this.needNormal !== value) { this.needNormal = value; this.invalidate(); } }
  setExtraTarget(target: ((source: XrInputSource) => Vec3 | null) | null) { this.extraTarget = target; }
  hit(source: XrInputSource) { return this.hits.get(source)?.hit ?? null; }
  async pick(source: XrInputSource): Promise<SurfaceHit | null> {
    const inverse = new Mat4().invert(this.handle.space.root.getWorldTransform());
    const hit = await this.handle.selection.surfaceHit(source.getOrigin().clone(), source.getDirection().clone(), this.needNormal);
    return hit ? { ...hit, point: inverse.transformPoint(hit.point) } : null;
  }
  private drawRays() {
    if (!this.app.xr?.active) return;
    for (const source of this.app.xr.input.inputSources) {
      if (!source.grip || source.hand) continue;
      let pointer = this.pointers.get(source);
      if (!pointer) {
        const positions = new Float32Array(6);
        const line = new WideLine().set(positions, [1, 1, 1, 1, 1, 1], 5);
        const tip = new Entity(`XR ${source.handedness} pointer`);
        this.app.root.addChild(tip);
        tip.addComponent("render", { type: "sphere", material: this.tipMaterial, layers: [this.rayLayer.id],
          castShadows: false, receiveShadows: false });
        tip.setLocalScale(.012, .012, .012);
        this.rays.add(line); pointer = { line, positions, tip }; this.pointers.set(source, pointer);
      }
      const origin = source.getOrigin(), direction = source.getDirection();
      const state = this.hits.get(source);
      const transform = this.handle.space.root.getWorldTransform();
      const element = source.elementEntity as unknown as ElementComponent | null;
      const surfacePointer = !element;
      const probeInterval = source.handedness === "right" ? 50 : 100;
      if (this.target.enabled && surfacePointer && (!state || (!state.pending && performance.now() - state.time >= probeInterval &&
        (state.revision !== this.revision || !state.transform.equals(transform) ||
          state.origin.distance(origin) > .0005 || state.direction.distance(direction) > .001)))) {
        const next = { origin: origin.clone(), direction: direction.clone(), transform: transform.clone(),
          hit: state?.hit ?? null, pending: true, time: performance.now(), revision: this.revision };
        this.hits.set(source, next);
        void this.pick(source).then(hit => { if (!this.disposed && this.hits.get(source) === next) next.hit = hit; })
          .catch(() => { next.hit = null; }).finally(() => { next.pending = false; });
      }
      const hit = this.target.enabled && surfacePointer ? this.hits.get(source)?.hit : null;
      this.end.copy(direction).mulScalar(rayLength).add(origin);
      if (hit) this.handle.space.toWorld(hit.point, this.end);
      const extra = this.extraTarget?.(source);
      if (extra) this.end.copy(extra);
      // ElementInput owns targeting; intersect its winning element's plane,
      // rather than creating a second UI picker or extending through the control.
      if (element) {
        const corners = element.worldCorners;
        this.normal.sub2(corners[1]!, corners[0]!); this.edge.sub2(corners[3]!, corners[0]!);
        this.normal.cross(this.normal, this.edge).normalize();
        this.plane.setFromPointNormal(corners[0]!, this.normal); this.ray.set(origin, direction);
        if (this.plane.intersectsRay(this.ray, this.uiPoint) && (!hit || origin.distance(this.uiPoint) < origin.distance(this.end)))
          this.end.copy(this.uiPoint).addScaled(direction, -.008);
      }
      const positions = pointer.positions;
      positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
      positions[3] = this.end.x; positions[4] = this.end.y; positions[5] = this.end.z;
      pointer.line.setPositions(pointer.positions);
      pointer.tip.setPosition(this.end);
    }
  }

  private remove(source: XrInputSource) {
    this.hits.delete(source);
    const pointer = this.pointers.get(source);
    if (pointer) { this.rays.remove(pointer.line); pointer.tip.destroy(); this.pointers.delete(source); }
    if (source === this.grabbing) this.grabbing = null;
  }

  destroy() {
    this.disposed = true; this.hits.clear(); this.extraTarget = null;
    this.app.off("prerender", this.drawRays, this);
    this.app.off("update", this.update, this); this.app.off("xr:controller:add", this.nameModel, this);
    this.app.xr?.input.off("remove", this.remove, this);
    this.rig.script?.destroy("xrManipulation");
    this.rays.destroy(); this.releaseRayLayer(); this.app.scene.layers.remove(this.rayLayer);
    for (const pointer of this.pointers.values()) pointer.tip.destroy();
    this.tipMaterial.destroy(); this.pointers.clear(); this.grabbing = null;
  }
}
