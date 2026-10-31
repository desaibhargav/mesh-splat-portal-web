import { LodData } from "./lod/LodData";
import { StreamedSplatBridge } from "./lod/StreamedSplatBridge";
import { Entity } from "@playcanvas/react";
import { GSplat } from "@playcanvas/react/components";
import { useApp, useSplat } from "@playcanvas/react/hooks";
import { useEffect, useMemo, useState } from "react";
import { Color, GSPLAT_BUDGET_LIMIT, Vec3, type BoundingBox, type CameraComponent, type Entity as PlayCanvasEntity } from "playcanvas";
import { ViewerViewports } from "./viewports/ViewerViewports";
import { ViewerSpace } from "./ViewerSpace";
import type { ViewerStatus } from "./ArtifactViewer";
import { frameBounds, ViewerCamera, type ViewerView } from "./ViewerCamera";
import { SplatSelection } from "./selection/SplatSelection";
import type { SelectionHandle } from "./selection/types";

export function SplatViewer({ url, lodUrl, onStatus, onSelectionReady }: {
  url: string; lodUrl?: string | null; onStatus(status: ViewerStatus): void;
  onSelectionReady(handle: SelectionHandle | null): void;
}) {
  const app = useApp();
  const result = useSplat(url);
  const [lod, setLod] = useState<LodData | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (lodUrl) void LodData.load(lodUrl, controller.signal).then(data => {
      if (!controller.signal.aborted) setLod(data);
    }).catch(error => {
      if (!controller.signal.aborted) onStatus({ loading: false, progress: 1, error: String(error) });
    });
    return () => controller.abort();
  }, [lodUrl, onStatus]);

  const view = useMemo(() => getSplatView(result.asset?.resource), [result.asset]);
  const [camera, setCamera] = useState<CameraComponent | null>(null);
  const [entity, setEntity] = useState<PlayCanvasEntity | null>(null);

  useEffect(() => result.subscribe(({ progress }) => onStatus({ loading: true, progress, error: null })), [result.subscribe, onStatus]);
  useEffect(() => onStatus({ loading: result.loading, progress: result.loading ? 0 : 1, error: result.error }), [result.loading, result.error, onStatus]);
  useEffect(() => {
    if (!entity || !result.asset || !camera || (lodUrl && !lod)) return;
    const params = app.scene.gsplat;
    const previous = { budget: params.splatBudget, mode: params.splatBudgetMode, distance: params.lodUpdateDistance };
    if (lod) {
      // The scene default is one million splats. It must not silently cap the finest published level.
      params.splatBudget = Math.max(previous.budget, lod.descriptor.levels[0]!.count);
      params.splatBudgetMode = GSPLAT_BUDGET_LIMIT;
      params.lodUpdateDistance = view.radius * .01;
    }
    let disposed = false;
    let viewports: ViewerViewports | undefined;
    let space: ViewerSpace | undefined;
    let selection: SplatSelection | undefined;
    let stream: StreamedSplatBridge | undefined;
    const dispose = () => { if (disposed) return; disposed = true; cancelAnimationFrame(frame); selection?.destroy(); selection = undefined; stream?.destroy(); stream = undefined; params.splatBudget = previous.budget; params.splatBudgetMode = previous.mode; params.lodUpdateDistance = previous.distance; space?.destroy(); space = undefined; viewports?.destroy(); viewports = undefined; };
    app.on("destroy", dispose);
    const frame = requestAnimationFrame(() => {
      try {
        if (!entity.gsplat) throw new Error("Splat component is unavailable.");
        const tint = new Color().fromString(getComputedStyle(app.graphicsDevice.canvas).getPropertyValue("--gold").trim());
        tint.linear();
        tint.a = 0.5;
        if (lod) stream = StreamedSplatBridge.create(entity.gsplat, lod, error => {
          onStatus({ loading: false, progress: 1, error: error.message });
        });
        selection = new SplatSelection(entity.gsplat, tint, stream);
        space = new ViewerSpace(entity, selection.bounds(null)!.center.clone());
        viewports = new ViewerViewports(app, camera);
        const rig = viewports;
        onSelectionReady({ app, space, viewports: rig, selection, camera: () => rig.active.camera });
      } catch (error) {
        dispose();
        onStatus({ loading: false, progress: 1, error: `Selection unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    });
    return () => {
      app.off("destroy", dispose);
      dispose(); onSelectionReady(null);
    };
  }, [app, entity, result.asset, camera, lodUrl, lod, view.radius, onSelectionReady, onStatus]);

  return (
    <>
      {result.asset && (
        <Entity ref={setEntity} rotation={[0, 0, 180]}>
          <GSplat asset={result.asset} key={result.asset.id} unified
            {...(lodUrl ? { lodBaseDistance: view.radius * 2, lodMultiplier: 2 } : {})} />
        </Entity>
      )}
      {result.asset && <ViewerCamera view={view} onReady={setCamera} />}
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
