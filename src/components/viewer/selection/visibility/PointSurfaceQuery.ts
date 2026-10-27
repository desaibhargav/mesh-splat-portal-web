import { Box3, BufferAttribute, BufferGeometry, Matrix3, Matrix4, Points, Raycaster, Vector3 } from "three";
import { CONTAINED, PointsBVH } from "three-mesh-bvh";
import type { SurfaceRayQuery, VolumeQuery } from "./visibilityTypes";
import { VolumeGeometry } from "../volume/VolumeGeometry";

// The library owns point indexing, BVH traversal and ray/point intersections.
// Application policy filters the scope/cut and returns a stable source-center ID.
export class PointSurfaceQuery {
  private readonly object: Points;
  private readonly tree: PointsBVH;
  private readonly raycaster = new Raycaster();
  private readonly point = new Vector3();
  private readonly center = new Vector3();
  private readonly spacing: number;
  private readonly normals = new Map<number, Vector3>();
  constructor(positions: Float32Array) {
    const geometry = new BufferGeometry().setAttribute("position", new BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    this.object = new Points(geometry); this.tree = new PointsBVH(geometry);
    this.spacing = geometry.boundingBox!.getSize(new Vector3()).length() / Math.sqrt(positions.length / 3);
  }
  surfaceHit(query: SurfaceRayQuery, visible: (Uint8Array | null)[]) {
    const object = this.object, raycaster = this.raycaster;
    object.matrixWorld.fromArray(query.parts[0]!.model); object.scale.setFromMatrixScale(object.matrixWorld);
    object.geometry.boundingBox!.getCenter(this.center).applyMatrix4(object.matrixWorld);
    raycaster.ray.origin.fromArray(query.origin); raycaster.ray.direction.fromArray(query.direction);
    raycaster.params.Points!.threshold = this.spacing * Math.max(object.scale.x, object.scale.y, object.scale.z) + raycaster.ray.origin.distanceTo(this.center) * .035;
    raycaster.firstHitOnly = !visible[0] && !query.section;
    const hits: { index?: number; distance: number }[] = [];
    this.tree.raycastObject3D(object, raycaster, hits as never[]);
    hits.sort((a, b) => a.distance - b.distance);
    for (const hit of hits) {
      const index = hit.index!;
      if (visible[0] && !visible[0][index]) continue;
      this.point.fromBufferAttribute(object.geometry.attributes.position!, index).applyMatrix4(object.matrixWorld);
      const plane = query.section;
      if (plane && this.point.x * plane[0]! + this.point.y * plane[1]! + this.point.z * plane[2]! + plane[3]! < 0) continue;
      const localNormal = query.normal ? this.normalAt(index) : null;
      const normal = localNormal?.clone().applyMatrix3(new Matrix3().getNormalMatrix(object.matrixWorld)).normalize();
      if (normal && normal.dot(raycaster.ray.direction) > 0) normal.negate();
      return { point: this.point.toArray(), normal: normal?.toArray(), part: 0, index };
    }
    return null;
  }
  private normalAt(index: number) {
    const cached = this.normals.get(index);
    if (cached) return cached;
    const attribute = this.object.geometry.attributes.position!;
    const center = new Vector3().fromBufferAttribute(attribute, index);
    const neighbors: Vector3[] = [];
    for (const distance of [3, 6]) {
      const radius = Math.max(this.spacing * distance, 1e-5);
      const box = new Box3().setFromCenterAndSize(center, new Vector3(radius * 2, radius * 2, radius * 2));
      this.tree.shapecast({
        intersectsBounds: bounds => neighbors.length < 32 && bounds.intersectsBox(box),
        intersectsPoint: ((candidate: Vector3, orderedIndex: number) => {
          const candidateIndex = this.object.geometry.index!.getX(orderedIndex);
          if (candidateIndex !== index && neighbors.length < 32 && candidate.distanceToSquared(center) <= radius * radius)
            neighbors.push(candidate.clone().sub(center));
          return false;
        }) as never
      });
      if (neighbors.length >= 3) break;
    }
    let best = 0, normal = new Vector3();
    for (let i = 0; i < neighbors.length; i++) for (let j = i + 1; j < neighbors.length; j++) {
      const cross = new Vector3().crossVectors(neighbors[i]!, neighbors[j]!);
      const area = cross.lengthSq();
      if (area > best) { best = area; normal = cross; }
    }
    if (best < 1e-12) return null;
    normal.normalize();
    if (this.normals.size >= 4096) this.normals.delete(this.normals.keys().next().value!);
    this.normals.set(index, normal);
    return normal;
  }
  selectVolume(query: VolumeQuery): Uint8Array[] {
    const volume = new VolumeGeometry(query.volume);
    try {
      const state = query.parts[0]!;
      const model = new Matrix4().fromArray(state.model);
      const transform = volume.inverse.clone().multiply(model);
      const mask = new Uint8Array(this.object.geometry.attributes.position!.count);
      if (!state.visible && !query.section && volume.containsBounds(this.tree.getBoundingBox(new Box3()).applyMatrix4(transform))) {
        mask.fill(255);
        return [mask];
      }
      const point = new Vector3(), world = new Vector3();
      this.tree.shapecast({
        intersectsBounds: box => {
          const bounds = box.clone().applyMatrix4(transform);
          if (!bounds.intersectsBox(volume.bounds)) return false;
          return volume.containsBounds(bounds) ? CONTAINED : true;
        },
        // v0.9.15 types list the first argument as an index, but the installed
        // iterator calls (point, orderedIndex, contained, depth).
        intersectsPoint: ((_candidate: Vector3, orderedIndex: number, contained: boolean) => {
          const index = this.object.geometry.index!.getX(orderedIndex);
          if (state.visible && !state.visible[index]) return false;
          if (!contained) {
            point.fromBufferAttribute(this.object.geometry.attributes.position!, index);
            if (!volume.contains(point.applyMatrix4(transform))) return false;
          }
          if (query.section) {
            world.fromBufferAttribute(this.object.geometry.attributes.position!, index).applyMatrix4(model);
            const plane = query.section;
            if (world.x * plane[0]! + world.y * plane[1]! + world.z * plane[2]! + plane[3]! < 0) return false;
          }
          mask[index] = 255;
          return false;
        }) as never
      });
      return [mask];
    } finally { volume.destroy(); }
  }
}
