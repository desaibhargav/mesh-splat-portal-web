import { Box3, BufferAttribute, BufferGeometry, Matrix4, Points, Raycaster, Vector3 } from "three";
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
      return { point: this.point.toArray(), part: 0, index };
    }
    return null;
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
