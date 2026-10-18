import { Entity, Gltf } from "@playcanvas/react";
import { Environment } from "@playcanvas/react/components";
import { useEnvAtlas, useModel } from "@playcanvas/react/hooks";
import { useEffect, useState } from "react";
import { BoundingBox, type Entity as PlayCanvasEntity, type MeshInstance } from "playcanvas";
import type { ViewerStatus } from "./ArtifactViewer";
import { frameBounds, ViewerCamera, type ViewerView } from "./ViewerCamera";

export function MeshViewer({ url, onStatus }: { url: string; onStatus(status: ViewerStatus): void }) {
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
    const frame = requestAnimationFrame(() => setView(getEntityView(target)));
    return () => cancelAnimationFrame(frame);
  }, [result.asset, target]);

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
