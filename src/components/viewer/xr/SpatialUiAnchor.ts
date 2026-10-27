import { Entity, Quat, Vec3, type AppBase } from "playcanvas";

// Level, leashed workspace UI: a stable target through ordinary head motion.
// Native transforms/math supply the mechanics; dead zones are UX policy.
export class SpatialUiAnchor {
  readonly root = new Entity("XR workspace UI");
  private readonly target = new Quat();
  private readonly rotation = new Quat();
  private readonly heading = new Vec3();
  private readonly forward = new Vec3();
  private readonly position = new Vec3();
  private initialized = false;
  private following = false;
  constructor(private readonly app: AppBase, private readonly camera: Entity, private readonly interacting: () => boolean) {
    app.root.addChild(this.root); app.on("update", this.update, this);
    app.xr!.once("update", this.initialize, this);
  }
  private initialize() {
    // XR start can precede its first tracked pose. Using the desktop camera
    // then makes the UI chase the headset during its first seconds in XR.
    this.heading.copy(this.camera.forward); this.heading.y = 0;
    if (this.heading.lengthSq() < .01) this.heading.copy(Vec3.FORWARD);
    this.heading.normalize();
    this.target.setFromEulerAngles(0, Math.atan2(-this.heading.x, -this.heading.z) * 180 / Math.PI, 0);
    this.root.setPosition(this.camera.getPosition()); this.root.setRotation(this.target); this.initialized = true;
  }
  frame() {
    this.heading.copy(this.camera.forward); this.heading.y = 0;
    if (this.heading.lengthSq() < .01) this.heading.copy(Vec3.FORWARD);
    this.heading.normalize();
    this.target.setFromEulerAngles(0, Math.atan2(-this.heading.x, -this.heading.z) * 180 / Math.PI, 0);
    this.root.setPosition(this.camera.getPosition()); this.root.setRotation(this.target);
    this.initialized = true; this.following = false;
  }
  private update(dt: number) {
    if (!this.app.xr?.active || !this.initialized) return;
    const head = this.camera.getPosition();
    this.heading.copy(this.camera.forward); this.heading.y = 0;
    if (this.heading.lengthSq() < .01) return; // Looking straight up/down supplies no yaw.
    this.heading.normalize();
    this.target.setFromEulerAngles(0, Math.atan2(-this.heading.x, -this.heading.z) * 180 / Math.PI, 0);
    if (this.interacting()) { this.following = false; return; }
    this.forward.copy(this.root.forward);
    const angle = Math.acos(Math.min(1, Math.max(-1, this.forward.dot(this.heading)))) * 180 / Math.PI;
    const current = this.root.getPosition(), distance = Math.hypot(head.x - current.x, head.z - current.z);
    if (angle > 35 || distance > .35) this.following = true;
    if (!this.following) return;
    const alpha = 1 - Math.exp(-3 * Math.min(dt, .05));
    this.position.set(head.x, current.y, head.z).lerp(current, this.position, alpha);
    this.root.setPosition(this.position);
    this.root.setRotation(this.rotation.slerp(this.root.getRotation(), this.target, alpha));
    if (angle < 3 && distance < .02) this.following = false;
  }
  destroy() { this.app.off("update", this.update, this); this.app.xr?.off("update", this.initialize, this); this.root.destroy(); }
}
