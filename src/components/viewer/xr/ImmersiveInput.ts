import { Mat4, Quat, Vec3, WideLine, WideLineRenderer, type AppBase, type Entity, type XrInputSource } from "playcanvas";
import { XrControllers } from "playcanvas/scripts/esm/xr/xr-controllers.mjs";
import { XrManipulation } from "playcanvas/scripts/esm/xr/xr-manipulation.mjs";

const profiles = "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles";
const rayLength = 1.5;

// Native scripts own model loading and the two-handed manipulation algorithm.
// This adapter adds only pointer visuals and full-pose, one-controller grabbing.
export class ImmersiveInput {
  private readonly rays: WideLineRenderer;
  private readonly pointers = new Map<XrInputSource, { line: WideLine; positions: Float32Array }>();
  private grabbing: XrInputSource | null = null;
  private readonly inverseGrip = new Mat4();
  private readonly initial = new Mat4();
  private readonly pose = new Mat4();
  private readonly result = new Mat4();
  private readonly position = new Vec3();
  private readonly rotation = new Quat();
  private readonly scale = new Vec3();
  private readonly end = new Vec3();

  constructor(private readonly app: AppBase, private readonly rig: Entity, private readonly target: Entity) {
    this.rays = new WideLineRenderer(app); this.rays.depthTest = false; this.rays.depthWrite = false;
    app.on("xr:controller:add", this.showModel, this);
    app.xr!.input.on("remove", this.remove, this);
    rig.addComponent("script");
    rig.script!.create(XrControllers, { properties: { basePath: profiles } });
    rig.script!.create(XrManipulation, { properties: { target, scalePivot: "hands", enableScale: false } });
    app.on("update", this.update, this);
  }

  private showModel(source: XrInputSource, entity: Entity) {
    entity.name = `XR controller ${source.handedness}`;
    // Splats have no scene lights. Controller models must remain visible there.
    for (const component of entity.findComponents("render")) {
      const render = component as import("playcanvas").RenderComponent;
      for (const instance of render.meshInstances) {
        const material = instance.material as import("playcanvas").StandardMaterial;
        material.useLighting = false; material.update();
      }
    }
  }

  private update() {
    if (!this.app.xr?.active) return;
    let held: XrInputSource | null = null, count = 0;
    for (const source of this.app.xr.input.inputSources) {
      if (!source.grip || source.hand) continue;
      if (source.squeezing) { held = source; count++; }
      let pointer = this.pointers.get(source);
      if (!pointer) {
        const positions = new Float32Array(6);
        const line = new WideLine().set(positions, [1, 1, 1, 1, 1, 1], 3);
        this.rays.add(line); pointer = { line, positions }; this.pointers.set(source, pointer);
      }
      const origin = source.getOrigin(), direction = source.getDirection();
      this.end.copy(direction).mulScalar(rayLength).add(origin);
      const positions = pointer.positions;
      positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
      positions[3] = this.end.x; positions[4] = this.end.y; positions[5] = this.end.z;
      pointer.line.setPositions(pointer.positions);
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

  private remove(source: XrInputSource) {
    const pointer = this.pointers.get(source);
    if (pointer) { this.rays.remove(pointer.line); this.pointers.delete(source); }
    if (source === this.grabbing) this.grabbing = null;
  }

  destroy() {
    this.app.off("update", this.update, this); this.app.off("xr:controller:add", this.showModel, this);
    this.app.xr?.input.off("remove", this.remove, this);
    this.rig.script?.destroy("xrControllers"); this.rig.script?.destroy("xrManipulation");
    this.rays.destroy(); this.pointers.clear(); this.grabbing = null;
  }
}
