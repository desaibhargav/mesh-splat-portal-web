import { Entity, Mat4, Quat, Vec3, Vec4, type BoundingBox } from "playcanvas";
import type { SelectionHandle } from "../selection/types";

// Presentation defaults in metres; source scans are not physically calibrated.
const displaySize = 1;
const viewingDistance = 1.5;

// A single presentation parent keeps tracked cameras/controllers in real metres.
// Saved coordinates and the asset's own orientation remain in their original space.
export class ImmersiveScene {
  readonly root = new Entity("Immersive artifact");
  private readonly parent;
  private readonly section: Float32Array;
  private readonly sectionTransform = new Mat4();
  private readonly previous = new Mat4();
  private readonly coefficients = new Vec4();
  private readonly transformed = new Float32Array(4);
  private readonly pivot = new Vec3();
  private readonly before = new Vec3();
  private readonly after = new Vec3();
  private readonly offset = new Vec3();
  private readonly baseScale: number;
  private readonly initialPosition = new Vec3();
  private readonly initialRotation = new Quat();
  private initialScale = 1;
  private grounded = false;

  constructor(private readonly handle: SelectionHandle, private readonly bounds: BoundingBox) {
    this.parent = handle.space.root.parent!;
    this.section = new Float32Array(handle.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue());
    handle.app.root.addChild(this.root); this.root.addChild(handle.space.root);
    this.baseScale = displaySize / (2 * Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z));
    this.root.setLocalScale(this.baseScale, this.baseScale, this.baseScale);
    handle.app.on("prerender", this.updateSection, this);
  }

  place(camera: Entity) {
    const forward = camera.getLocalRotation().transformVector(Vec3.FORWARD);
    forward.y = 0;
    if (!forward.lengthSq()) forward.copy(Vec3.FORWARD);
    forward.normalize();
    const yaw = Math.atan2(-forward.x, -forward.z) * 180 / Math.PI;
    const rotation = new Quat().setFromEulerAngles(0, yaw, 0);
    this.root.setRotation(rotation);
    const position = camera.getLocalPosition().clone().add(forward.mulScalar(viewingDistance));
    this.root.setPosition(position.sub(rotation.transformVector(this.bounds.center).mulScalar(this.root.getLocalScale().x)));
    this.rememberPlacement();
    this.updateSection();
  }

  placeOnFloor(point: Vec3, camera: Entity) {
    this.grounded = true;
    const forward = camera.forward.clone(); forward.y = 0;
    if (!forward.lengthSq()) forward.copy(Vec3.FORWARD);
    forward.normalize();
    const yaw = Math.atan2(-forward.x, -forward.z) * 180 / Math.PI;
    const rotation = new Quat().setFromEulerAngles(0, yaw, 0);
    this.root.setRotation(rotation);
    const scale = this.root.getLocalScale().x;
    const center = rotation.transformVector(this.bounds.center.clone().mulScalar(scale));
    this.root.setPosition(point.x - center.x, point.y - (this.bounds.center.y - this.bounds.halfExtents.y) * scale, point.z - center.z);
    this.root.enabled = true;
    this.rememberPlacement();
    this.updateSection();
  }

  center(out: Vec3) { return this.root.getWorldTransform().transformPoint(this.bounds.center, out); }

  private rememberPlacement() {
    this.initialPosition.copy(this.root.getPosition());
    this.initialRotation.copy(this.root.getRotation());
    this.initialScale = this.root.getLocalScale().x;
  }

  reset() {
    this.root.setLocalScale(this.initialScale, this.initialScale, this.initialScale);
    this.root.setRotation(this.initialRotation);
    this.root.setPosition(this.initialPosition);
  }

  frame(camera: Entity) {
    const center = this.center(new Vec3());
    const destination = camera.getPosition().clone().add(camera.forward.clone().mulScalar(viewingDistance));
    this.root.setPosition(this.root.getPosition().clone().add(destination.sub(center)));
  }

  rotateAroundCenter(rotation: Quat, center: Vec3) {
    this.root.setRotation(rotation);
    this.pivot.copy(this.bounds.center).mulScalar(this.root.getLocalScale().x);
    rotation.transformVector(this.pivot, this.before);
    this.root.setPosition(this.offset.sub2(center, this.before));
  }

  zoom(factor: number) {
    const current = this.root.getLocalScale().x;
    const next = Math.min(this.baseScale * 4, Math.max(this.baseScale * .25, current * factor));
    if (next === current) return;
    this.pivot.copy(this.bounds.center);
    if (this.grounded) this.pivot.y -= this.bounds.halfExtents.y;
    this.root.getWorldTransform().transformPoint(this.pivot, this.before);
    this.root.setLocalScale(next, next, next);
    this.root.getWorldTransform().transformPoint(this.pivot, this.after);
    this.offset.sub2(this.before, this.after);
    this.root.setPosition(this.root.getPosition().add(this.offset));
  }

  private updateSection() {
    if (!this.handle.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue()) return;
    const transform = this.root.getWorldTransform();
    if (this.previous.equals(transform)) return;
    this.previous.copy(transform);
    // The saved cut is in source scene coordinates. Move its plane with the
    // artifact using the engine's inverse-transpose and vector operations.
    this.coefficients.set(this.section[0]!, this.section[1]!, this.section[2]!, this.section[3]!);
    this.sectionTransform.invert(transform).transpose().transformVec4(this.coefficients, this.coefficients);
    this.transformed.set(this.coefficients.toArray());
    this.handle.app.graphicsDevice.scope.resolve("portalSectionPlane").setValue(this.transformed);
  }

  destroy() {
    this.handle.app.off("prerender", this.updateSection, this);
    this.handle.app.graphicsDevice.scope.resolve("portalSectionPlane").setValue(this.section);
    if (this.handle.space.root.parent) this.parent.addChild(this.handle.space.root);
    this.root.destroy();
  }
}
