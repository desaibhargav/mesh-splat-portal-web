import { Plane, Quat, Ray, Vec3, type AppBase, type Entity, type XrInputSource } from "playcanvas";
import { ImmersiveScene } from "./ImmersiveScene";

// Controllers provide tracked rays and select state; PlayCanvas supplies the
// plane/ray and quaternion math. The same gestures drive AR and VR after placement.
export class ImmersiveGestures {
  private orbiting: XrInputSource | null = null;
  private panning: XrInputSource | null = null;
  private readonly startHand = new Vec3();
  private readonly startPosition = new Vec3();
  private readonly startCenter = new Vec3();
  private readonly delta = new Vec3();
  private readonly startRotation = new Quat();
  private readonly head = new Quat();
  private readonly inverseHead = new Quat();
  private readonly localTurn = new Quat();
  private readonly worldTurn = new Quat();
  private readonly rotation = new Quat();
  private readonly plane = new Plane();
  private readonly ray = new Ray();
  private readonly panStart = new Vec3();
  private readonly panNow = new Vec3();
  private readonly nextPosition = new Vec3();
  private readonly panGestureOrigin = new Vec3();
  private readonly rightAxis = new Vec3();
  private readonly upAxis = new Vec3();

  constructor(private readonly app: AppBase, private readonly camera: Entity,
    private readonly scene: ImmersiveScene, private readonly ready: () => boolean,
    private readonly menuTargeted: () => boolean, private readonly measuring: () => boolean) {
    app.on("update", this.update, this);
  }

  private update(dt: number) {
    if (!this.app.xr?.active || !this.ready()) { this.orbiting = this.panning = null; return; }
    const sources = this.app.xr.input.inputSources;
    const left = sources.find(source => source.handedness === "left" && source.grip && !source.hand);
    const right = sources.find(source => source.handedness === "right" && source.grip && !source.hand);
    if (left?.selecting && right?.selecting) { this.orbiting = this.panning = null; return; }
    if (left && !left.squeezing && !left.selecting) this.zoom(left, dt);
    // The menu hover flag is global: a right-hand ray over a menu button must
    // not stop the independent left-hand orbit gesture.
    if (left?.selecting && !left.squeezing) this.orbit(left);
    else this.orbiting = null;
    if (right?.selecting && !right.squeezing && !this.menuTargeted()) this.pan(right);
    else this.panning = null;
  }

  private zoom(source: XrInputSource, dt: number) {
    const axis = source.gamepad?.axes[3] ?? 0;
    if (Math.abs(axis) < .15) return;
    // Forward on the stick is negative Y. Exponential gain is frame-rate independent.
    this.scene.zoom(Math.exp(-axis * Math.min(dt, .05) * 1.5));
  }

  private orbit(source: XrInputSource) {
    const hand = source.getPosition(); if (!hand) return;
    const root = this.scene.root;
    if (this.orbiting !== source) {
      this.orbiting = source; this.startHand.copy(hand);
      this.startRotation.copy(root.getRotation());
      this.scene.center(this.startCenter);
      this.head.copy(this.camera.getRotation()); this.inverseHead.copy(this.head).invert();
      return;
    }
    this.delta.sub2(hand, this.startHand);
    this.head.transformVector(Vec3.RIGHT, this.rightAxis);
    this.head.transformVector(Vec3.UP, this.upAxis);
    this.localTurn.setFromEulerAngles(-this.delta.dot(this.upAxis) * 360, this.delta.dot(this.rightAxis) * 360, 0);
    this.worldTurn.mul2(this.head, this.localTurn).mul(this.inverseHead);
    // Compute every pose from the gesture's original pivot. Accumulating a
    // correction onto last frame's position makes long orbit drags drift.
    this.scene.rotateAroundCenter(this.rotation.mul2(this.worldTurn, this.startRotation), this.startCenter);
  }

  private pan(source: XrInputSource) {
    const root = this.scene.root;
    if (this.panning !== source) {
      this.panning = source; this.startPosition.copy(root.getPosition());
      this.panGestureOrigin.copy(source.getPosition() ?? source.getOrigin());
      this.scene.center(this.startCenter);
      this.plane.setFromPointNormal(this.startCenter, this.camera.forward);
      this.ray.set(source.getOrigin(), source.getDirection());
      if (!this.plane.intersectsRay(this.ray, this.panStart)) this.panStart.copy(source.getPosition() ?? source.getOrigin());
      return;
    }
    // A short right-trigger tap picks a measurement point. Dragging past this
    // spatial threshold retains the usual pan gesture in the same tool.
    if (this.measuring() && this.panGestureOrigin.distance(source.getPosition() ?? source.getOrigin()) < .02) return;
    this.ray.set(source.getOrigin(), source.getDirection());
    if (!this.plane.intersectsRay(this.ray, this.panNow)) return;
    this.delta.sub2(this.panNow, this.panStart);
    root.setPosition(this.nextPosition.copy(this.startPosition).add(this.delta));
  }

  destroy() { this.app.off("update", this.update, this); }
}
