import { BoundingBox, Mat4, Vec3 } from "playcanvas";

export class SelectionBounds {
  private min = new Vec3(Infinity, Infinity, Infinity);
  private max = new Vec3(-Infinity, -Infinity, -Infinity);
  private point = new Vec3();
  add(positions: ArrayLike<number>, offset: number, transform: Mat4) {
    this.point.set(positions[offset]!, positions[offset + 1]!, positions[offset + 2]!);
    transform.transformPoint(this.point, this.point);
    this.min.min(this.point); this.max.max(this.point);
  }
  get value(): BoundingBox | null {
    if (!Number.isFinite(this.min.x)) return null;
    const bounds = new BoundingBox(); bounds.setMinMax(this.min, this.max); return bounds;
  }
}
