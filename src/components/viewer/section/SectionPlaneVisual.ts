import { BLEND_NORMAL, CULLFACE_NONE, Color, Entity, Layer, StandardMaterial } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import type { ViewFrame } from "../views/viewFrame";

export class SectionPlaneVisual {
  readonly root = new Entity("Section plane");
  private readonly plane = new Entity("Plane guide");
  private readonly layer = new Layer({ name: "Section guide" });
  private readonly material = new StandardMaterial();
  private readonly releaseLayer: () => void;
  constructor(private readonly handle: SelectionHandle, parent = handle.app.root) {
    const gold = new Color(215 / 255, 188 / 255, 119 / 255);
    this.material.useLighting = this.material.useFog = false;
    this.material.diffuse.copy(gold); this.material.emissive.copy(gold);
    this.material.opacity = .35; this.material.blendType = BLEND_NORMAL; this.material.cull = CULLFACE_NONE;
    this.material.depthWrite = false; this.material.update();
    parent.addChild(this.root); this.root.addChild(this.plane); this.plane.setLocalEulerAngles(90, 0, 0);
    this.plane.addComponent("render", { type: "plane", material: this.material, layers: [this.layer.id], castShadows: false, receiveShadows: false });
    const layers = handle.app.scene.layers;
    layers.insert(this.layer, layers.layerList.findIndex(layer => layer.name === "UI"));
    this.releaseLayer = handle.viewports.shareLayer(this.layer.id);
  }
  update(frame: ViewFrame, extent: number) {
    this.root.setLocalPosition(frame.origin); this.root.setLocalRotation(frame.rotation);
    this.plane.setLocalScale(extent * 2, 1, extent * 2);
  }
  destroy() {
    this.root.destroy(); this.material.destroy(); this.releaseLayer(); this.handle.app.scene.layers.remove(this.layer);
  }
}
