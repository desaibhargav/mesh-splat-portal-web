import { BoundingBox, Vec3 } from "playcanvas";

export class Measurement {
  private snapshots: (readonly Vec3[])[][] = [[]];
  private cursor = 0;
  get segments(): readonly (readonly Vec3[])[] { return this.snapshots[this.cursor]!; }
  get points(): readonly Vec3[] { return this.segments.at(-1) ?? []; }
  get distance(): number | null { return this.points.length === 2 ? this.points[0]!.distance(this.points[1]!) : null; }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor + 1 < this.snapshots.length; }
  add(point: Vec3, additional = false) {
    if (this.points.length === 2) {
      if (additional) this.change([...this.segments, [point.clone()]]);
    } else this.change([...this.segments.slice(0, -1), [...this.points, point.clone()]]);
  }
  clear() { if (this.segments.length) this.change([]); }
  undo() { if (this.canUndo) this.cursor--; }
  redo() { if (this.canRedo) this.cursor++; }
  bounds(): BoundingBox | null {
    const points = this.segments.flat();
    if (!points.length) return null;
    const min = points[0]!.clone(), max = min.clone();
    for (const point of points) { min.min(point); max.max(point); }
    const bounds = new BoundingBox(); bounds.setMinMax(min, max); return bounds;
  }
  private change(points: (readonly Vec3[])[]) {
    this.snapshots.splice(++this.cursor);
    this.snapshots.push(points);
  }
}

export function formatDistance(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(value);
}
