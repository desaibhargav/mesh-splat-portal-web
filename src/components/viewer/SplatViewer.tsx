import type { LodData } from "./lod/LodData";
import { StreamedSplatBridge } from "./lod/StreamedSplatBridge";
import { LOD_UPDATE_DISTANCE_RATIO } from "./lod/lodMetric";
import { Entity } from "@playcanvas/react";
import { GSplat } from "@playcanvas/react/components";
import { useApp, useSplat } from "@playcanvas/react/hooks";
import { useEffect, useMemo, useState } from "react";
import { Color, Vec3, type BoundingBox, type CameraComponent, type Entity as PlayCanvasEntity } from "playcanvas";
import { ViewerViewports } from "./viewports/ViewerViewports";
import { ViewerSpace } from "./ViewerSpace";
import type { ViewerStatus } from "./ArtifactViewer";
import { frameBounds, ViewerCamera, type ViewerView } from "./ViewerCamera";
import { SplatSelection } from "./selection/SplatSelection";
import type { SelectionHandle } from "./selection/types";

export function SplatViewer({ url, lod, onStatus, onSelectionReady }: {
  url: string; lod?: LodData; onStatus(status: ViewerStatus): void;
  onSelectionReady(handle: SelectionHandle | null): void;
}) {
  const app = useApp();
  const result = useSplat(lod ? lod.file(lod.descriptor.stream!) : url);
  const view = useMemo(() => getSplatView(result.asset?.resource), [result.asset]);
  const [camera, setCamera] = useState<CameraComponent | null>(null);
  const [entity, setEntity] = useState<PlayCanvasEntity | null>(null);

  useEffect(() => result.subscribe(({ progress }) => onStatus({ loading: true, progress, error: null })), [result.subscribe, onStatus]);
  useEffect(() => onStatus({ loading: result.loading, progress: result.loading ? 0 : 1, error: result.error }), [result.loading, result.error, onStatus]);
  useEffect(() => {
    if (!entity || !result.asset || !camera) return;
    const model = entity, primary = camera;
    const previousLodUpdateDistance = app.scene.gsplat.lodUpdateDistance;
    if (lod) app.scene.gsplat.lodUpdateDistance = view.radius * LOD_UPDATE_DISTANCE_RATIO;
    let disposed = false;
    let stream: StreamedSplatBridge | undefined;
    let viewports: ViewerViewports | undefined;
    let space: ViewerSpace | undefined;
    let selection: SplatSelection | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      selection?.destroy(); selection = undefined;
      stream?.destroy(); stream = undefined;
      space?.destroy(); space = undefined;
      viewports?.destroy(); viewports = undefined;
      if (lod) app.scene.gsplat.lodUpdateDistance = previousLodUpdateDistance;
    };
    app.on("destroy", dispose);
    const frame = requestAnimationFrame(() => { void initialize(); });
    function initialize() {
      try {
        if (!model.gsplat) throw new Error("Splat component is unavailable.");
        const tint = new Color().fromString(getComputedStyle(app.graphicsDevice.canvas).getPropertyValue("--gold").trim());
        tint.linear();
        tint.a = 0.5;
        if (lod) {
          stream = StreamedSplatBridge.create(model.gsplat, lod, error => {
            model.gsplat?.hide(); onStatus({ loading: false, progress: 1, error: error.message });
          });
          if (disposed) { stream.destroy(); return; }
        }
        selection = new SplatSelection(model.gsplat, tint, stream);
        space = new ViewerSpace(model, selection.bounds(null)!.center.clone());
        viewports = new ViewerViewports(app, primary);
        const rig = viewports;
        onSelectionReady({ app, space, viewports: rig, selection, camera: () => rig.active.camera });
      } catch (error) {
        dispose();
        onStatus({ loading: false, progress: 1, error: `Selection unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return () => {
      app.off("destroy", dispose);
      dispose(); onSelectionReady(null);
    };
  }, [app, entity, result.asset, camera, lod, view.radius, onSelectionReady, onStatus]);

  return (
    <>
      {result.asset && (
        <Entity ref={setEntity} rotation={[0, 0, 180]}>
          <GSplat asset={result.asset} key={result.asset.id} unified
            {...(lod ? { lodBaseDistance: view.radius * 2, lodMultiplier: 2 } : {})} />
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
