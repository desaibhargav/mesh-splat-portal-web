import { BoundingBox, Entity, EventHandler, Mat4, Quat, Vec3 } from "playcanvas";

// One rigid presentation transform; asset geometry and saved point coordinates
// stay unchanged. Both formats and all point tools use this same space.
export class ViewerSpace extends EventHandler {
  readonly root = new Entity("Asset orientation");
  private readonly parent;
  private readonly inverse = new Mat4();
  constructor(private readonly asset: Entity, readonly pivot: Vec3) {
    super();
    this.parent = asset.parent!;
    this.parent.addChild(this.root); this.root.addChild(asset);
  }
  get rotation() { return this.root.getRotation().clone(); }
  setRotation(rotation: Quat) {
    this.root.setRotation(rotation);
    this.root.setPosition(this.pivot.clone().sub(rotation.transformVector(this.pivot)));
    this.fire("change");
  }
  toWorld(point: Vec3, result = new Vec3()) { return this.root.getWorldTransform().transformPoint(point, result); }
  toLocal(point: Vec3, result = new Vec3()) { return this.inverse.invert(this.root.getWorldTransform()).transformPoint(point, result); }
  worldBounds(bounds: BoundingBox) {
    const result = new BoundingBox(); result.setFromTransformedAabb(bounds, this.root.getWorldTransform()); return result;
  }
  destroy() {
    this.parent.addChild(this.asset); this.root.destroy(); this.off();
  }
}
