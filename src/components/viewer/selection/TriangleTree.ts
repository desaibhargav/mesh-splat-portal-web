import { CULLFACE_BACK, CULLFACE_FRONT, CULLFACE_NONE, type Vec3 } from "playcanvas";

interface Node { min: number[]; max: number[]; start: number; end: number; left: number; right: number }

// A median-split triangle hierarchy keeps visibility independent of screen resolution.
// Ray distances use a segment parameter: the candidate's centroid is at t=1.
export class TriangleTree {
  private readonly order: Uint32Array;
  private readonly nodes: Node[] = [];
  constructor(private readonly positions: Float32Array, private readonly indices: number[], private readonly centers: Float32Array,
    private readonly cull: number, leafSize = 8) {
    this.order = Uint32Array.from({ length: indices.length / 3 }, (_, i) => i);
    const build = (start: number, end: number): number => {
      const node: Node = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], start, end, left: -1, right: -1 };
      const index = this.nodes.push(node) - 1;
      for (let i = start; i < end; i++) for (let corner = 0; corner < 3; corner++) {
        const vertex = indices[this.order[i]! * 3 + corner]! * 3;
        for (let axis = 0; axis < 3; axis++) {
          node.min[axis] = Math.min(node.min[axis]!, positions[vertex + axis]!);
          node.max[axis] = Math.max(node.max[axis]!, positions[vertex + axis]!);
        }
      }
      if (end - start > leafSize) {
        const extents = node.max.map((value, axis) => value - node.min[axis]!);
        const axis = extents.indexOf(Math.max(...extents)), middle = (start + end) >>> 1;
        this.partition(start, end - 1, middle, axis);
        node.left = build(start, middle); node.right = build(middle, end);
      }
      return index;
    };
    if (this.order.length) build(0, this.order.length);
  }
  private partition(low: number, high: number, middle: number, axis: number) {
    while (low < high) {
      const pivot = this.centers[this.order[(low + high) >>> 1]! * 3 + axis]!;
      let left = low, right = high;
      while (left <= right) {
        while (this.centers[this.order[left]! * 3 + axis]! < pivot) left++;
        while (this.centers[this.order[right]! * 3 + axis]! > pivot) right--;
        if (left <= right) {
          const value = this.order[left]!; this.order[left++] = this.order[right]!; this.order[right--] = value;
        }
      }
      if (middle <= right) high = right;
      else if (middle >= left) low = left;
      else return;
    }
  }
  private hit(face: number, origin: Vec3, direction: Vec3, min: number, max: number): boolean {
    const a = this.indices[face * 3]! * 3, b = this.indices[face * 3 + 1]! * 3, c = this.indices[face * 3 + 2]! * 3, p = this.positions;
    const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
    const ex = p[b]! - ax, ey = p[b + 1]! - ay, ez = p[b + 2]! - az;
    const fx = p[c]! - ax, fy = p[c + 1]! - ay, fz = p[c + 2]! - az;
    const px = direction.y * fz - direction.z * fy, py = direction.z * fx - direction.x * fz, pz = direction.x * fy - direction.y * fx;
    const determinant = ex * px + ey * py + ez * pz;
    if (determinant === 0 || (this.cull === CULLFACE_BACK && determinant < 0) || (this.cull === CULLFACE_FRONT && determinant > 0)) return false;
    const tx = origin.x - ax, ty = origin.y - ay, tz = origin.z - az, inverse = 1 / determinant;
    const u = (tx * px + ty * py + tz * pz) * inverse;
    if (u < 0 || u > 1) return false;
    const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex;
    const v = (direction.x * qx + direction.y * qy + direction.z * qz) * inverse;
    if (v < 0 || u + v > 1) return false;
    const distance = (fx * qx + fy * qy + fz * qz) * inverse;
    return distance >= min && distance <= max;
  }
  facing(face: number, origin: Vec3, direction: Vec3): boolean {
    return this.cull === CULLFACE_NONE || this.hit(face, origin, direction, 1 - 2 ** -20, 1 + 2 ** -20);
  }
  occludes(origin: Vec3, direction: Vec3, min: number, mask?: Uint8Array): boolean {
    const max = 1 - 2 ** -20;
    const visit = (index: number): boolean => {
      const node = this.nodes[index]!;
      let near = min, far = max;
      for (let axis = 0; axis < 3; axis++) {
        const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
        const d = axis === 0 ? direction.x : axis === 1 ? direction.y : direction.z;
        if (d === 0) { if (o < node.min[axis]! || o > node.max[axis]!) return false; }
        else {
          const a = (node.min[axis]! - o) / d, b = (node.max[axis]! - o) / d;
          near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
          if (near > far) return false;
        }
      }
      if (node.left >= 0) return visit(node.left) || visit(node.right);
      for (let i = node.start; i < node.end; i++) {
        const face = this.order[i]!;
        if ((!mask || mask[face]) && this.hit(face, origin, direction, min, max)) return true;
      }
      return false;
    };
    return this.nodes.length > 0 && visit(0);
  }
}
