import { BufferAttribute, BufferGeometry, Points, Raycaster, Vector3 } from "three";
import { PointsBVH } from "three-mesh-bvh";
import type { SurfaceRayQuery } from "./visibilityTypes";

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
    this.object = new Points(geometry); this.tree = new PointsBVH(geometry, { indirect: true });
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
}
