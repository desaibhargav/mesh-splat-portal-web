import { Box3, BufferAttribute, BufferGeometry, ExtrudeGeometry, Matrix4, Shape, ShapeUtils, Sphere, Vector2, Vector3 } from "three";
import { ExtendedTriangle, MeshBVH, PointsBVH } from "three-mesh-bvh";
import type { SelectionVolume } from "./SelectionVolume";

// Edit-time geometry query, shared by mesh faces and splat centers. Three owns
// polygon triangulation and triangle intersection; three-mesh-bvh owns spatial
// traversal. The portal supplies only the selection policy and coordinate frame.
export class VolumeGeometry {
  readonly inverse: Matrix4;
  readonly bounds = new Box3();
  private readonly points: Vector2[];
  private readonly convex: boolean;
  private readonly surface: ExtrudeGeometry | null;
  private readonly tree: MeshBVH | null;
  private readonly spheres: Sphere[] = [];
  private readonly brushTree: PointsBVH | null = null;
  private readonly brushBounds = new Box3();
  private readonly face = new ExtendedTriangle();
  private readonly faceBounds = new Box3();
  private readonly closest = new Vector3();

  constructor(readonly volume: SelectionVolume) {
    if (volume.shape === "brush") {
      if (!Number.isFinite(volume.radius) || volume.radius <= 0 || !volume.centers.length ||
          volume.centers.some(center => center.some(value => !Number.isFinite(value))))
        throw new Error("Draw a nonempty 3D brush stroke.");
      this.inverse = new Matrix4(); this.points = []; this.convex = false; this.surface = this.tree = null;
      this.spheres = volume.centers.map(center => new Sphere(new Vector3(...center), volume.radius));
      if (this.spheres.length > 8) {
        const positions = new Float32Array(volume.centers.flat());
        this.brushTree = new PointsBVH(new BufferGeometry().setAttribute("position", new BufferAttribute(positions, 3)));
      }
      for (const sphere of this.spheres) this.bounds.expandByPoint(sphere.center.clone().addScalar(-sphere.radius))
        .expandByPoint(sphere.center.clone().addScalar(sphere.radius));
      return;
    }
    if (volume.outline.length < 3 || !Number.isFinite(volume.depth) || volume.depth <= 0 ||
        volume.outline.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1])))
      throw new Error("Draw a nonempty selection volume.");
    this.inverse = new Matrix4().fromArray(volume.matrix).invert();
    const points = this.points = volume.outline.map(([x, y]) => new Vector2(x, y));
    for (const point of points) {
      this.bounds.expandByPoint(new Vector3(point.x, point.y, 0));
      this.bounds.expandByPoint(new Vector3(point.x, point.y, volume.depth));
    }
    if (this.bounds.max.x - this.bounds.min.x < 1e-6 || this.bounds.max.y - this.bounds.min.y < 1e-6)
      throw new Error("Draw a larger selection volume.");
    const winding = Math.sign(this.signedArea());
    this.convex = volume.shape === "rectangle" || points.every((point, index) => {
      const next = points[(index + 1) % points.length]!, after = points[(index + 2) % points.length]!;
      const cross = (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
      return Math.abs(cross) < 1e-10 || Math.sign(cross) === winding;
    });
    if (volume.shape === "rectangle") { this.surface = this.tree = null; return; }
    const triangles = ShapeUtils.triangulateShape(points, []);
    if (!triangles.length) throw new Error("The lasso outline could not form a volume.");
    const outlineArea = Math.abs(this.signedArea());
    const triangulatedArea = triangles.reduce((sum, [a, b, c]) => {
      const p = points[a!]!, q = points[b!]!, r = points[c!]!;
      return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
    }, 0);
    if (outlineArea < 1e-8 || Math.abs(triangulatedArea - outlineArea) > Math.max(1e-8, outlineArea * .01))
      throw new Error("The lasso crosses itself. Draw a simple closed outline.");
    const shape = new Shape(points);
    this.surface = new ExtrudeGeometry(shape, { depth: volume.depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
    this.tree = new MeshBVH(this.surface);
  }

  private signedArea() {
    return this.points.reduce((sum, point, index) => {
      const next = this.points[(index + 1) % this.points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2;
  }

  contains(point: Vector3) {
    if (!this.bounds.containsPoint(point)) return false;
    if (this.volume.shape === "brush") {
      if (!this.brushTree) return this.spheres.some(sphere => sphere.containsPoint(point));
      const radius = this.volume.radius;
      this.brushBounds.setFromCenterAndSize(point, new Vector3(radius * 2, radius * 2, radius * 2));
      // The installed PointsBVH declaration calls this argument an index; its implementation passes a Vector3.
      return this.brushTree.shapecast({ intersectsBounds: box => box.intersectsBox(this.brushBounds),
        intersectsPoint: ((candidate: Vector3) => candidate.distanceToSquared(point) <= radius * radius) as never });
    }
    if (this.volume.shape === "rectangle") return true;
    // Ray crossing is an elementary point-in-polygon test. The library handles
    // triangulation and boundary intersections; this avoids testing every
    // resident splat against every cap triangle in a large lasso.
    let inside = false;
    for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
      const a = this.points[j]!, b = this.points[i]!;
      if (point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) &&
          point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y) &&
          Math.abs((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) < 1e-10) return true;
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  containsBounds(box: Box3) {
    if (this.volume.shape === "brush") return false;
    if (!this.convex || box.min.z < this.bounds.min.z || box.max.z > this.bounds.max.z ||
        !this.bounds.containsBox(box)) return false;
    if (this.volume.shape === "rectangle") return true;
    return this.contains(new Vector3(box.min.x, box.min.y, box.min.z)) &&
      this.contains(new Vector3(box.min.x, box.max.y, box.min.z)) &&
      this.contains(new Vector3(box.max.x, box.min.y, box.min.z)) &&
      this.contains(new Vector3(box.max.x, box.max.y, box.min.z));
  }

  intersectsTriangle(triangle: ExtendedTriangle, transform: Matrix4) {
    this.face.a.copy(triangle.a).applyMatrix4(transform);
    this.face.b.copy(triangle.b).applyMatrix4(transform);
    this.face.c.copy(triangle.c).applyMatrix4(transform);
    this.face.needsUpdate = true;
    if (!this.bounds.intersectsTriangle(this.face)) return false;
    if (this.volume.shape === "brush") {
      const radius = this.volume.radius;
      if (!this.brushTree) return this.spheres.some(sphere =>
        this.face.closestPointToPoint(sphere.center, this.closest).distanceToSquared(sphere.center) <= radius * radius);
      this.faceBounds.setFromPoints([this.face.a, this.face.b, this.face.c]).expandByScalar(radius);
      return this.brushTree.shapecast({ intersectsBounds: box => box.intersectsBox(this.faceBounds),
        intersectsPoint: ((candidate: Vector3) => this.face.closestPointToPoint(candidate, this.closest).distanceToSquared(candidate) <= radius * radius) as never });
    }
    if (this.volume.shape === "rectangle") return true;
    if (this.contains(this.face.a) || this.contains(this.face.b) || this.contains(this.face.c)) return true;
    this.faceBounds.setFromPoints([this.face.a, this.face.b, this.face.c]);
    return this.tree!.shapecast({
      intersectsBounds: box => box.intersectsBox(this.faceBounds),
      intersectsTriangle: boundary => boundary.intersectsTriangle(this.face)
    });
  }

  destroy() { this.surface?.dispose(); this.brushTree?.geometry.dispose(); }
}
