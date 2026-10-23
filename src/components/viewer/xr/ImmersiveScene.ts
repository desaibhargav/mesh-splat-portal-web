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

  constructor(private readonly handle: SelectionHandle, private readonly bounds: BoundingBox) {
    this.parent = handle.space.root.parent!;
    this.section = new Float32Array(handle.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue());
    handle.app.root.addChild(this.root); this.root.addChild(handle.space.root);
    const scale = displaySize / (2 * Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z));
    this.root.setLocalScale(scale, scale, scale);
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
    this.updateSection();
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
