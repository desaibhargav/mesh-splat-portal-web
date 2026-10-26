import { BLEND_NORMAL, CULLFACE_NONE, Color, Entity, Layer, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, StandardMaterial, Vec3 } from "playcanvas";
import { Matrix4, ShapeUtils, Vector2, Vector3 } from "three";
import type { SelectionHandle } from "../selection/types";
import type { SelectionVolume } from "../selection/volume/SelectionVolume";

// Small transient editor geometry. It follows the artifact's presentation
// transform, but is never included in picking or saved with the selection.
export class SelectionVolumeVisual {
  private readonly layer = new Layer({ name: "XR selection volume" });
  private readonly material = new StandardMaterial();
  private readonly handleMaterial = new StandardMaterial();
  private readonly entity = new Entity("XR selection volume");
  private readonly handleEntity = new Entity("XR volume depth handle");
  private readonly mesh: Mesh;
  private positions: number[] = [];
  private readonly indices: number[] = [];
  private readonly releaseLayer: () => void;
  private readonly center = new Vector3();
  private readonly vertex = new Vector3();
  private disposed = false;

  constructor(private readonly viewer: SelectionHandle, readonly volume: SelectionVolume,
    private readonly localFrame: Matrix4, goldHex: string) {
    const { app } = viewer;
    app.scene.layers.push(this.layer);
    this.releaseLayer = viewer.viewports.shareLayer(this.layer.id);
    viewer.space.root.addChild(this.entity);
    viewer.space.root.addChild(this.handleEntity);
    const gold = new Color().fromString(goldHex).linear();
    this.material.useLighting = this.material.useFog = this.material.useTonemap = false;
    this.material.useSkybox = false;
    this.material.diffuse.copy(gold); this.material.emissive.copy(gold);
    this.material.opacity = .12; this.material.blendType = BLEND_NORMAL; this.material.cull = CULLFACE_NONE;
    this.material.depthTest = this.material.depthWrite = false; this.material.update();
    this.handleMaterial.useLighting = this.handleMaterial.useFog = this.handleMaterial.useTonemap = false;
    this.handleMaterial.useSkybox = false; this.handleMaterial.diffuse.copy(gold);
    this.handleMaterial.emissive.copy(gold); this.handleMaterial.depthTest = this.handleMaterial.depthWrite = false;
    this.handleMaterial.update();
    this.handleEntity.addComponent("render", { type: "sphere", material: this.handleMaterial, layers: [this.layer.id],
      castShadows: false, receiveShadows: false });
    this.handleEntity.setLocalScale(.045, .045, .045);
    this.mesh = new Mesh(app.graphicsDevice);
    this.setOutline(volume.outline);
    const instance = new MeshInstance(this.mesh, this.material, this.entity);
    instance.pick = false;
    this.entity.addComponent("render", { meshInstances: [instance], layers: [this.layer.id], castShadows: false, receiveShadows: false });
  }

  // Keep one PlayCanvas mesh while the controller draws. The outline is capped
  // at 128 vertices by the gesture adapter; only a changed stroke uploads it.
  setOutline(outline: [number, number][]) {
    this.volume.outline = outline;
    const points = outline.map(([x, y]) => new Vector2(x, y));
    const triangles = ShapeUtils.triangulateShape(points, []), n = points.length;
    this.indices.length = 0;
    for (const [a, b, c] of triangles) this.indices.push(a!, c!, b!, a! + n, b! + n, c! + n);
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      this.indices.push(i, next, i + n, next, next + n, i + n);
    }
    this.positions = new Array(n * 6).fill(0);
    this.mesh.setIndices(this.indices);
    this.update();
  }

  private updateGeometry() {
    const n = this.volume.outline.length;
    for (let i = 0; i < n; i++) {
      const [x, y] = this.volume.outline[i]!;
      this.vertex.set(x, y, 0).applyMatrix4(this.localFrame);
      this.positions[i * 3] = this.vertex.x; this.positions[i * 3 + 1] = this.vertex.y; this.positions[i * 3 + 2] = this.vertex.z;
      this.vertex.set(x, y, this.volume.depth).applyMatrix4(this.localFrame);
      this.positions[(i + n) * 3] = this.vertex.x;
      this.positions[(i + n) * 3 + 1] = this.vertex.y;
      this.positions[(i + n) * 3 + 2] = this.vertex.z;
    }
    this.mesh.setPositions(this.positions);
  }
  update() {
    if (this.disposed) return;
    this.volume.matrix = new Matrix4().fromArray(this.viewer.space.root.getWorldTransform().data).multiply(this.localFrame).toArray();
    this.updateGeometry(); this.mesh.update(PRIMITIVE_TRIANGLES);
    const n = this.volume.outline.length;
    this.center.set(0, 0, this.volume.depth);
    for (const [x, y] of this.volume.outline) { this.center.x += x / n; this.center.y += y / n; }
    const local = this.center.applyMatrix4(this.localFrame);
    this.handleEntity.setLocalPosition(local.x, local.y, local.z);
    this.viewer.app.renderNextFrame = true;
  }
  handleWorld(target = new Vec3()) { return this.handleEntity.getWorldTransform().getTranslation(target); }
  axisWorld(target = new Vec3()) {
    const matrix = new Matrix4().fromArray(this.viewer.space.root.getWorldTransform().data).multiply(this.localFrame);
    const origin = new Vector3(0, 0, 0).applyMatrix4(matrix);
    const end = new Vector3(0, 0, 1).applyMatrix4(matrix);
    return target.set(end.x - origin.x, end.y - origin.y, end.z - origin.z);
  }
  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.entity.destroy(); this.handleEntity.destroy();
    // RenderComponent destroys its MeshInstance, which releases the mesh.
    this.material.destroy(); this.handleMaterial.destroy();
    this.releaseLayer(); this.viewer.app.scene.layers.remove(this.layer);
  }
}
