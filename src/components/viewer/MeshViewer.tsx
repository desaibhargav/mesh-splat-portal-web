import { Entity, Gltf } from "@playcanvas/react";
import { Environment } from "@playcanvas/react/components";
import { useApp, useEnvAtlas, useModel } from "@playcanvas/react/hooks";
import { useEffect, useState } from "react";
import { BoundingBox, Color, type Entity as PlayCanvasEntity, type MeshInstance } from "playcanvas";
import { ViewerSpace } from "./ViewerSpace";
import type { ViewerStatus } from "./ArtifactViewer";
import { frameBounds, interactiveCamera, ViewerCamera, type ViewerView } from "./ViewerCamera";
import { MeshSelection } from "./selection/MeshSelection";
import type { SelectionHandle } from "./selection/types";

export function MeshViewer({ url, onStatus, onSelectionReady }: {
  url: string; onStatus(status: ViewerStatus): void; onSelectionReady(handle: SelectionHandle | null): void;
}) {
  const app = useApp();
  const result = useModel(url);
  const environment = useEnvAtlas("/lighting/studio-small-08.png");
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

    // Gltf attaches its render hierarchy in an effect. Measure it on the next frame.
    let space: ViewerSpace | undefined;
    let selection: MeshSelection | undefined;
    const dispose = () => { cancelAnimationFrame(frame); selection?.destroy(); selection = undefined; space?.destroy(); space = undefined; };
    app.on("destroy", dispose);
    const frame = requestAnimationFrame(() => {
      setView(getEntityView(target));
      try {
        const tint = new Color().fromString(getComputedStyle(app.graphicsDevice.canvas).getPropertyValue("--gold").trim()).linear();
        tint.a = 0.5;
        selection = new MeshSelection(target, app, tint);
        space = new ViewerSpace(target, selection.bounds(null)!.center.clone());
        onSelectionReady({ app, space, selection, camera: () => interactiveCamera(app) });
      } catch (error) {
        onStatus({ loading: false, progress: 1, error: `Selection unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    });
    return () => { app.off("destroy", dispose); dispose(); onSelectionReady(null); };
  }, [result.asset, target, app, onSelectionReady, onStatus]);

  return (
    <>
      {result.asset && <Entity ref={setTarget}><Gltf asset={result.asset} key={result.asset.id} /></Entity>}
      {view && <ViewerCamera view={view} />}
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
