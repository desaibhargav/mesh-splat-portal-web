import { useEffect, useRef } from "react";
import { BLEND_NORMAL, CULLFACE_NONE, Color, Entity, Layer, StandardMaterial } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import type { ViewFrame } from "../views/viewFrame";

export function SectionGuide({ handle, frame, extent }: { handle: SelectionHandle; frame: ViewFrame; extent: number }) {
  const entities = useRef<{ root: Entity; plane: Entity } | null>(null);
  useEffect(() => {
    const camera = handle.camera(), layer = new Layer({ name: "Section guide" });
    const material = new StandardMaterial();
    material.useLighting = false; material.emissive.copy(Color.WHITE);
    material.opacity = 0.15; material.blendType = BLEND_NORMAL; material.cull = CULLFACE_NONE;
    material.depthWrite = false; material.update();
    const root = new Entity("Section plane"), plane = new Entity("Plane guide");
    handle.app.root.addChild(root); root.addChild(plane);
    entities.current = { root, plane };
    plane.setLocalEulerAngles(90, 0, 0);
    plane.addComponent("render", { type: "plane", material, layers: [layer.id], castShadows: false, receiveShadows: false });
    handle.app.scene.layers.push(layer); camera.layers = [...camera.layers, layer.id];
    let disposed = false;
    const dispose = () => {
      if (disposed) return; disposed = true;
      handle.app.off("destroy", dispose); root.destroy(); material.destroy(); entities.current = null;
      camera.layers = camera.layers.filter(id => id !== layer.id); handle.app.scene.layers.remove(layer);
    };
    handle.app.on("destroy", dispose);
    return dispose;
  }, [handle]);
  useEffect(() => {
    const { root, plane } = entities.current!;
    root.setPosition(frame.origin); root.setRotation(frame.rotation);
    plane.setLocalScale(extent * 2, 1, extent * 2);
  }, [handle, frame, extent]);
  return null;
}
