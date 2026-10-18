import { Entity } from "@playcanvas/react";
import { GSplat } from "@playcanvas/react/components";
import { useApp, useSplat } from "@playcanvas/react/hooks";
import { useEffect, useMemo, useState } from "react";
import { Color, Vec3, type BoundingBox, type Entity as PlayCanvasEntity } from "playcanvas";
import type { ViewerStatus } from "./ArtifactViewer";
import { frameBounds, ViewerCamera, type ViewerView } from "./ViewerCamera";
import { SplatSelection } from "./selection/SplatSelection";
import type { SelectionHandle } from "./selection/types";

export function SplatViewer({ url, onStatus, selecting, onSelectionReady }: {
  url: string; onStatus(status: ViewerStatus): void;
  selecting: boolean; onSelectionReady(handle: SelectionHandle | null): void;
}) {
  const app = useApp();
  const result = useSplat(url);
  const view = useMemo(() => getSplatView(result.asset?.resource), [result.asset]);
  const [entity, setEntity] = useState<PlayCanvasEntity | null>(null);

  useEffect(() => result.subscribe(({ progress }) => onStatus({ loading: true, progress, error: null })), [result.subscribe, onStatus]);
  useEffect(() => onStatus({ loading: result.loading, progress: result.loading ? 0 : 1, error: result.error }), [result.loading, result.error, onStatus]);
  useEffect(() => {
    if (!entity || !result.asset) return;
    let selection: SplatSelection | undefined;
    const frame = requestAnimationFrame(() => {
      try {
        if (!entity.gsplat) throw new Error("Splat component is unavailable.");
        const tint = new Color().fromString(getComputedStyle(app.graphicsDevice.canvas).getPropertyValue("--gold").trim());
        tint.linear();
        tint.a = 0.5;
        selection = new SplatSelection(entity.gsplat, tint);
        onSelectionReady({ app, selection, camera: () => {
          const camera = app.systems.camera!.cameras[0];
          if (!camera) throw new Error("Viewer camera is unavailable.");
          return camera;
        } });
      } catch (error) {
        onStatus({ loading: false, progress: 1, error: `Selection unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      onSelectionReady(null);
      selection?.destroy();
    };
  }, [app, entity, result.asset, onSelectionReady, onStatus]);

  return (
    <>
      {result.asset && (
        <Entity ref={setEntity} rotation={[0, 0, 180]}>
          <GSplat asset={result.asset} key={result.asset.id} unified />
        </Entity>
      )}
      {result.asset && <ViewerCamera view={view} controlsEnabled={!selecting} />}
    </>
  );
}

function getSplatView(resource: unknown): ViewerView {
  const splat = resource as {
    aabb?: BoundingBox;
    gsplatData?: {
      meta?: {
        portalView?: {
          position: [number, number, number];
          target: [number, number, number];
          fov?: number;
        };
      };
    };
  } | null;
  const portalView = splat?.gsplatData?.meta?.portalView;
  if (portalView) {
    const position = rotateAroundZ(portalView.position);
    const focusPoint = new Vec3(...rotateAroundZ(portalView.target));
    return {
      cameraPosition: position,
      focusPoint,
      radius: Math.max(new Vec3(...position).distance(focusPoint), 0.01),
      fov: portalView.fov
    };
  }

  const aabb = splat?.aabb;
  if (!aabb) return { cameraPosition: [0, 0, 3.3], focusPoint: new Vec3(), radius: 1 };

  // The splat is rotated 180° around Z, so its object-space center is mirrored on X/Y.
  return frameBounds(aabb, (center) => center.set(-center.x, -center.y, center.z));
}

function rotateAroundZ([x, y, z]: [number, number, number]): [number, number, number] {
  return [-x, -y, z];
}
