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
  private readonly currentCenter = new Vec3();
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
  private readonly rightAxis = new Vec3();
  private readonly upAxis = new Vec3();

  constructor(private readonly app: AppBase, private readonly camera: Entity,
    private readonly scene: ImmersiveScene, private readonly ready: () => boolean) {
    app.on("update", this.update, this);
  }

  private update(dt: number) {
    if (!this.app.xr?.active || !this.ready()) { this.orbiting = this.panning = null; return; }
    const sources = this.app.xr.input.inputSources;
    const left = sources.find(source => source.handedness === "left" && source.grip && !source.hand);
    const right = sources.find(source => source.handedness === "right" && source.grip && !source.hand);
    if (left && !left.squeezing && !left.selecting) this.zoom(left, dt);
    if (left?.selecting && !left.squeezing) this.orbit(left);
    else this.orbiting = null;
    if (right?.selecting && !right.squeezing) this.pan(right);
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
      this.startPosition.copy(root.getPosition()); this.startRotation.copy(root.getRotation());
      this.scene.center(this.startCenter);
      this.head.copy(this.camera.getRotation()); this.inverseHead.copy(this.head).invert();
      return;
    }
    this.delta.sub2(hand, this.startHand);
    this.head.transformVector(Vec3.RIGHT, this.rightAxis);
    this.head.transformVector(Vec3.UP, this.upAxis);
    this.localTurn.setFromEulerAngles(-this.delta.dot(this.upAxis) * 360, this.delta.dot(this.rightAxis) * 360, 0);
    this.worldTurn.mul2(this.head, this.localTurn).mul(this.inverseHead);
    root.setRotation(this.rotation.mul2(this.worldTurn, this.startRotation));
    this.scene.center(this.currentCenter);
    root.setPosition(this.nextPosition.copy(this.startPosition).add(this.startCenter).sub(this.currentCenter));
  }

  private pan(source: XrInputSource) {
    const root = this.scene.root;
    if (this.panning !== source) {
      this.panning = source; this.startPosition.copy(root.getPosition());
      this.scene.center(this.startCenter);
      this.plane.setFromPointNormal(this.startCenter, this.camera.forward);
      this.ray.set(source.getOrigin(), source.getDirection());
      if (!this.plane.intersectsRay(this.ray, this.panStart)) this.panStart.copy(source.getPosition() ?? source.getOrigin());
      return;
    }
    this.ray.set(source.getOrigin(), source.getDirection());
    if (!this.plane.intersectsRay(this.ray, this.panNow)) return;
    this.delta.sub2(this.panNow, this.panStart);
    root.setPosition(this.nextPosition.copy(this.startPosition).add(this.delta));
  }

  destroy() { this.app.off("update", this.update, this); }
}
