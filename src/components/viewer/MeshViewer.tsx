import type { LodData } from "./lod/LodData";
import { MeshLodSelection } from "./lod/MeshLodSelection";
import { setSectionPlane } from "./section/sectionPlane";
import { Entity, Gltf } from "@playcanvas/react";
import { Environment } from "@playcanvas/react/components";
import { useApp, useEnvAtlas, useModel } from "@playcanvas/react/hooks";
import { useEffect, useState } from "react";
import { BoundingBox, Color, type Entity as PlayCanvasEntity, type CameraComponent, type MeshInstance } from "playcanvas";
import { ViewerViewports } from "./viewports/ViewerViewports";
import { ViewerSpace } from "./ViewerSpace";
import type { ViewerStatus } from "./ArtifactViewer";
import { frameBounds, ViewerCamera, type ViewerView } from "./ViewerCamera";
import { MeshSelection } from "./selection/MeshSelection";
import type { SelectionHandle } from "./selection/types";

export function MeshViewer({ url, lod, onStatus, onSelectionReady }: {
  url: string; lod?: LodData; onStatus(status: ViewerStatus): void; onSelectionReady(handle: SelectionHandle | null): void;
}) {
  const app = useApp();
  const result = useModel(lod ? lod.file(lod.descriptor.levels[2]!.file!) : url);
  const environment = useEnvAtlas("/lighting/studio-small-08.png");
  const [camera, setCamera] = useState<CameraComponent | null>(null);
  const [target, setTarget] = useState<PlayCanvasEntity | null>(null);
  const [view, setView] = useState<ViewerView | null>(null);

  useEffect(() => result.subscribe(({ progress }) => onStatus({ loading: true, progress, error: null })), [result.subscribe, onStatus]);
  useEffect(() => {
    const loading = result.loading || environment.loading;
    onStatus({ loading, progress: loading ? 0 : 1, error: result.error ?? environment.error });
  }, [result.loading, result.error, environment.loading, environment.error, onStatus]);
  useEffect(() => {
    if (!target || !result.asset) {
      setView(null);
      return;
    }

    const frame = requestAnimationFrame(() => setView(getEntityView(target)));
    return () => cancelAnimationFrame(frame);
  }, [target, result.asset]);
  useEffect(() => {
    if (!target || !result.asset || !camera) return;
    const model = target, primary = camera;
    let disposed = false;
    let viewports: ViewerViewports | undefined;
    let space: ViewerSpace | undefined;
    let selection: MeshSelection | MeshLodSelection | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      selection?.destroy(); selection = undefined;
      space?.destroy(); space = undefined;
      viewports?.destroy(); viewports = undefined;
    };
    app.on("destroy", dispose);
    const frame = requestAnimationFrame(() => { void initialize(); });
    function initialize() {
      try {
        const tint = new Color().fromString(getComputedStyle(app.graphicsDevice.canvas).getPropertyValue("--gold").trim()).linear();
        tint.a = 0.5;
        setSectionPlane(app, null);
        selection = new MeshSelection(model, app, tint);
        space = new ViewerSpace(model, selection.bounds(null)!.center.clone());
        viewports = new ViewerViewports(app, primary);
        if (lod) {
          selection = MeshLodSelection.create(app, model, tint, lod, viewports, selection,
            error => onStatus({ loading: false, progress: 1, error: error.message }));
          if (disposed) { selection.destroy(); return; }
        }
        const rig = viewports;
        onSelectionReady({ app, space, viewports: rig, selection, camera: () => rig.active.camera });
      } catch (error) {
        dispose();
        onStatus({ loading: false, progress: 1, error: `Selection unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return () => { app.off("destroy", dispose); dispose(); onSelectionReady(null); };
  }, [result.asset, target, camera, app, lod, onSelectionReady, onStatus]);

  return (
    <>
      {result.asset && <Entity ref={setTarget}><Gltf asset={result.asset} key={result.asset.id} /></Entity>}
      {view && <ViewerCamera view={view} onReady={setCamera} />}
      {environment.asset && <Environment envAtlas={environment.asset} showSkybox={false} />}
    </>
  );
}

function getEntityView(entity: PlayCanvasEntity): ViewerView | null {
  const meshInstances = entity
    .findComponents("render")
    .flatMap((component) => (component as unknown as { meshInstances: MeshInstance[] }).meshInstances);

  if (!meshInstances.length) return null;

  const bounds = new BoundingBox();
  meshInstances.forEach((instance, index) => {
    if (index === 0) bounds.copy(instance.aabb);
    else bounds.add(instance.aabb);
  });
  return frameBounds(bounds);
}
