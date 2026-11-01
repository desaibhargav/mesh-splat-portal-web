import { Gizmo, Mat4, Ray, RotateGizmo, Vec3, type CameraComponent, type Layer, type MeshInstance, type XrInputSource } from "playcanvas";

// PlayCanvas 2.23.3 RotateGizmo owns ring geometry, highlighting, axis-plane
// rotation and drag events. Its DOM picker has no controller-ray entry point.
// This narrow adapter follows Gizmo._getSelection (PlayCanvas, MIT) with an XR
// ray; its intersections still use the engine's native handle triangles.
// Adapted picker copyright (c) 2011-2026 PlayCanvas Ltd.; MIT notice ships at
// /licenses/playcanvas.txt. Source: engine v2.23.3 src/extras/gizmo/gizmo.js.
export class ControllerRotateGizmo extends RotateGizmo {
  private readonly controllerRay = new Ray();
  private readonly localRay = new Ray();
  private readonly world = new Mat4();
  private readonly inverse = new Mat4();
  private readonly point = new Vec3();
  private readonly hitPoint = new Vec3();
  private selectedMesh: MeshInstance | undefined;
  dragging = false;
  constructor(camera: CameraComponent, layer: Layer) {
    super(camera, layer);
    this.rotationMode = "orbit";
    this.mouseButtons[0] = this.mouseButtons[1] = this.mouseButtons[2] = false;
    this.enableShape("f", false); this.enableShape("xyz", false);
    this._shapes.f.entity.enabled = this._shapes.xyz.entity.enabled = false;
  }
  planeOnly() { this.enableShape("z", false); this._shapes.z.entity.enabled = false; }
  protected override _createRay(_position: Vec3) { return this.controllerRay; }
  target(source: XrInputSource): Vec3 | null {
    this.controllerRay.set(source.getOrigin(), source.getDirection());
    let distance = Infinity, priority = 0;
    this.selectedMesh = undefined;
    for (const shape of this.intersectShapes) {
      if (shape.disabled || !shape.entity.enabled) continue;
      for (const data of shape.triData) {
        this.world.mul2(shape.entity.getWorldTransform(), data.transform); this.inverse.invert(this.world);
        this.inverse.transformPoint(this.controllerRay.origin, this.localRay.origin);
        this.inverse.transformVector(this.controllerRay.direction, this.localRay.direction).normalize();
        for (const triangle of data.tris) if (triangle.intersectsRay(this.localRay, this.point)) {
          this.world.transformPoint(this.point, this.point);
          const next = this.point.distance(this.controllerRay.origin);
          if ((data.priority && priority && data.priority > priority) ||
              (!(data.priority && priority && data.priority < priority) && next < distance)) {
            distance = next; priority = data.priority; this.hitPoint.copy(this.point); this.selectedMesh = shape.meshInstances[0];
          }
        }
      }
    }
    return this.selectedMesh ? this.hitPoint : null;
  }
  move(source: XrInputSource) {
    const hit = this.target(source);
    this.fire(Gizmo.EVENT_POINTERMOVE, 0, 0, this.selectedMesh);
    return hit;
  }
  start(source: XrInputSource) {
    if (!this.target(source)) return false;
    this.dragging = true; this.fire(Gizmo.EVENT_POINTERDOWN, 0, 0, this.selectedMesh); return true;
  }
  end() { if (this.dragging) this.fire(Gizmo.EVENT_POINTERUP, 0, 0); this.dragging = false; }
}
