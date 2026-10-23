import { BLEND_NORMAL, Color, Entity, Quat, StandardMaterial, Vec3, type AppBase, type XrInputSource } from "playcanvas";
import { ImmersiveScene } from "./ImmersiveScene";

// Native WebXR hit tests find real surfaces; the only app policy is accepting
// upward-facing hits so the artifact rests on a floor or tabletop.
export class ImmersivePlacement {
  private readonly reticle = new Entity("AR placement target");
  private readonly material = new StandardMaterial();
  private readonly sources = new Map<XrInputSource, XRHitTestSource>();
  private readonly pending = new Set<XrInputSource>();
  private readonly hits = new Map<XrInputSource, { point: Vec3; at: number }>();
  private readonly up = new Vec3();
  private readonly orientation = new Quat();
  private readonly point = new Vec3();
  private reference: XRReferenceSpace | null = null;
  private disposed = false;
  placed = false;

  constructor(private readonly app: AppBase, private readonly scene: ImmersiveScene, private readonly camera: Entity) {
    scene.root.enabled = false;
    this.material.useLighting = false; this.material.useFog = false;
    this.material.diffuse.copy(Color.GREEN); this.material.emissive.copy(Color.GREEN);
    this.material.opacity = 0.7; this.material.blendType = BLEND_NORMAL; this.material.update();
    app.root.addChild(this.reticle);
    this.reticle.addComponent("render", { type: "cylinder", material: this.material });
    this.reticle.setLocalScale(.12, .003, .12); this.reticle.enabled = false;
    app.xr!.on("start", this.startSources, this);
    app.xr!.input.on("add", this.startSource, this);
    app.xr!.input.on("remove", this.removeSource, this);
    app.xr!.input.on("selectstart", this.select, this);
    app.xr!.on("update", this.update, this);
  }

  private async startSources() {
    const session = this.app.xr?.session;
    if (!session?.requestHitTestSource) return;
    try { this.reference = await session.requestReferenceSpace("local-floor"); }
    catch { return; }
    if (this.disposed || !this.app.xr?.active) return;
    for (const source of this.app.xr!.input.inputSources) this.startSource(source);
  }

  private startSource(source: XrInputSource) {
    const session = this.app.xr?.session, request = session?.requestHitTestSource?.bind(session);
    if (this.disposed || this.placed || !this.reference || !request || this.pending.has(source) || this.sources.has(source)) return;
    this.pending.add(source);
    // PlayCanvas's input-source helper requests transient hit tests. Persistent
    // controller rays need the WebXR targetRaySpace, which PlayCanvas exposes.
    const promise = request({ space: source.inputSource.targetRaySpace });
    if (!promise) { this.pending.delete(source); return; }
    void promise.then(test => {
      this.pending.delete(source);
      if (this.disposed || this.placed || !this.app.xr?.active || !this.app.xr.input.inputSources.includes(source)) { test.cancel(); return; }
      this.sources.set(source, test);
    }).catch(() => { this.pending.delete(source); });
  }

  private removeSource(source: XrInputSource) {
    this.hits.delete(source); this.pending.delete(source);
    this.sources.get(source)?.cancel(); this.sources.delete(source);
  }

  private update(frame: XRFrame) {
    if (this.placed) return;
    if (this.reference) for (const [source, test] of this.sources) {
      const result = frame.getHitTestResults(test)[0];
      const pose = result?.getPose(this.reference);
      if (!pose) continue;
      const { position, orientation } = pose.transform;
      this.orientation.set(orientation.x, orientation.y, orientation.z, orientation.w);
      this.orientation.transformVector(Vec3.UP, this.up);
      if (this.up.dot(Vec3.UP) < .75) continue;
      this.point.set(position.x, position.y, position.z);
      let hit = this.hits.get(source);
      if (!hit) { hit = { point: new Vec3(), at: 0 }; this.hits.set(source, hit); }
      hit.point.copy(this.point); hit.at = performance.now();
    }
    let latest: { point: Vec3; at: number } | undefined;
    const now = performance.now();
    for (const hit of this.hits.values()) if (now - hit.at < 250 && (!latest || hit.at > latest.at)) latest = hit;
    this.reticle.enabled = !!latest;
    if (latest) this.reticle.setPosition(latest.point);
  }

  private select(source: XrInputSource) {
    const hit = this.hits.get(source);
    if (!hit || performance.now() - hit.at >= 250 || this.placed) return;
    this.scene.placeOnFloor(hit.point, this.camera);
    this.placed = true; this.reticle.enabled = false;
    for (const test of this.sources.values()) test.cancel();
    this.sources.clear(); this.hits.clear();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.app.xr?.off("start", this.startSources, this);
    this.app.xr?.input.off("add", this.startSource, this);
    this.app.xr?.input.off("remove", this.removeSource, this);
    this.app.xr?.input.off("selectstart", this.select, this);
    this.app.xr?.off("update", this.update, this);
    for (const test of this.sources.values()) test.cancel();
    this.sources.clear(); this.hits.clear(); this.pending.clear();
    this.reticle.destroy(); this.material.destroy();
  }
}
