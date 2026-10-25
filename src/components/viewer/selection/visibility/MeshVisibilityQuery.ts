import { BufferAttribute, BufferGeometry, Frustum, Matrix4, Ray, Vector3, type Side } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { SurfaceRayQuery, VisibilityGeometry, VisibilityQuery } from "./visibilityTypes";

// The upstream selection example combines shapecast pruning with raycastFirst
// for centroid visibility. Use those public library queries, retaining native
// GPU hits for partially visible faces and gesture boundaries. No Three renderer.
// https://github.com/gkjohnson/three-mesh-bvh/blob/v0.9.15/example/src/computeSelectedTriangles.js
export class MeshVisibilityQuery {
  private readonly trees: MeshBVH[];
  constructor(geometry: VisibilityGeometry[]) {
    this.trees = geometry.map(part => {
      const geometry = new BufferGeometry().setAttribute("position", new BufferAttribute(part.positions, 3));
      geometry.setIndex(new BufferAttribute(part.indices, 1));
      return new MeshBVH(geometry, { indirect: true });
    });
  }

  // Reuse the selection BVHs for live surface pointing. The public library
  // query handles traversal/intersection; app policy filters hidden/cut faces.
  raycast(query: SurfaceRayQuery, visible: (Uint8Array | null)[]): number[] | null {
    return this.surfaceHit(query, visible)?.point ?? null;
  }
  surfaceHit(query: SurfaceRayQuery, visible: (Uint8Array | null)[]): { point: number[]; part: number; index: number } | null {
    const origin = new Vector3().fromArray(query.origin), direction = new Vector3().fromArray(query.direction);
    let distance = Infinity, result: { point: number[]; part: number; index: number } | null = null;
    this.trees.forEach((tree, index) => {
      const part = query.parts[index]!, model = new Matrix4().fromArray(part.model), inverse = model.clone().invert();
      const ray = new Ray(origin, direction).clone().applyMatrix4(inverse);
      const filtered = !!visible[index] || !!query.section;
      const hits = filtered ? tree.raycast(ray, part.side as Side) : [tree.raycastFirst(ray, part.side as Side)];
      for (const hit of hits) {
        if (!hit || hit.faceIndex == null || (visible[index] && !visible[index]![hit.faceIndex])) continue;
        const world = hit.point.applyMatrix4(model), plane = query.section;
        if (plane && world.x * plane[0]! + world.y * plane[1]! + world.z * plane[2]! + plane[3]! < 0) continue;
        const candidate = origin.distanceToSquared(world);
        if (candidate < distance) { distance = candidate; result = { point: world.toArray(), part: index, index: hit.faceIndex }; }
      }
    });
    return result;
  }

  select(query: VisibilityQuery): Uint8Array[] {
    const { width, height, alpha } = query;
    let left = width, right = 0, top = height, bottom = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (alpha[y * width + x]) {
      left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
    }
    if (right === 0) return query.hits;
    const x0 = left / width * 2 - 1, x1 = right / width * 2 - 1, y0 = 1 - bottom / height * 2, y1 = 1 - top / height * 2;
    const crop = new Matrix4().set(2 / (x1 - x0), 0, 0, -(x1 + x0) / (x1 - x0),
      0, 2 / (y1 - y0), 0, -(y1 + y0) / (y1 - y0), 0, 0, 1, 0, 0, 0, 0, 1);
    const projectionView = new Matrix4().multiplyMatrices(new Matrix4().fromArray(query.projection), new Matrix4().fromArray(query.view));
    const inverseViewProjection = projectionView.clone().invert();
    const models = query.parts.map(part => new Matrix4().fromArray(part.model)), inverses = models.map(matrix => matrix.clone().invert());
    const visible = (part: number, face: number) => !query.parts[part]!.visible || !!query.parts[part]!.visible![face];
    const retained = (world: Vector3) => !query.section || world.x * query.section[0]! + world.y * query.section[1]! + world.z * query.section[2]! + query.section[3]! >= 0;
    const nearest = (point: Vector3, center: Vector3, targetPart: number, targetFace: number): boolean => {
      const origin = new Vector3(point.x, point.y, -1).applyMatrix4(inverseViewProjection), target = center.clone().applyMatrix4(models[targetPart]!);
      let nearestDistance = Infinity, selected = false;
      this.trees.forEach((tree, part) => {
        const localOrigin = origin.clone().applyMatrix4(inverses[part]!), localTarget = part === targetPart ? center : target.clone().applyMatrix4(inverses[part]!);
        const ray = new Ray(localOrigin, localTarget.clone().sub(localOrigin).normalize()), state = query.parts[part]!;
        const candidates = state.visible || query.section ? tree.raycast(ray, state.side as Side) : [tree.raycastFirst(ray, state.side as Side)];
        for (const hit of candidates) {
          if (!hit || hit.faceIndex == null || !visible(part, hit.faceIndex)) continue;
          const world = hit.point.clone().applyMatrix4(models[part]!);
          if (!retained(world)) continue;
          const worldDistance = origin.distanceTo(world);
          if (worldDistance < nearestDistance) {
            nearestDistance = worldDistance;
            selected = part === targetPart && hit.faceIndex === targetFace;
          }
        }
      });
      return selected;
    };
    this.trees.forEach((tree, part) => {
      const mvp = projectionView.clone().multiply(models[part]!), inverse = mvp.clone().invert();
      const bounds = new Frustum().setFromProjectionMatrix(crop.clone().multiply(mvp));
      const center = new Vector3(), normal = new Vector3(), origin = new Vector3();
      tree.shapecast({
        intersectsBounds: box => bounds.intersectsBox(box),
        intersectsTriangle: (triangle, face) => {
          if (query.hits[part]![face] || !visible(part, face)) return false;
          triangle.getMidpoint(center);
          if (!bounds.containsPoint(center) || !retained(center.clone().applyMatrix4(models[part]!))) return false;
          const point = center.clone().applyMatrix4(mvp), x = Math.floor((point.x + 1) * width / 2), y = Math.floor((1 - point.y) * height / 2);
          if (x < 0 || x >= width || y < 0 || y >= height || !alpha[y * width + x]) return false;
          origin.set(point.x, point.y, -1).applyMatrix4(inverse).sub(center);
          const facing = triangle.getNormal(normal).dot(origin), side = query.parts[part]!.side;
          if (!facing || (side === 0 && facing < 0) || (side === 1 && facing > 0)) return false;
          if (nearest(point, center, part, face)) query.hits[part]![face] = 255;
          return false;
        }
      });
    });
    return query.hits;
  }
}
