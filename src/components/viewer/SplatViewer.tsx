import { Entity } from "@playcanvas/react";
import { GSplat } from "@playcanvas/react/components";
import { useSplat } from "@playcanvas/react/hooks";
import { useEffect } from "react";
import { Vec3, type BoundingBox } from "playcanvas";
import type { ViewerStatus } from "./ArtifactViewer";
import { frameBounds, ViewerCamera, type ViewerView } from "./ViewerCamera";

export function SplatViewer({ url, onStatus }: { url: string; onStatus(status: ViewerStatus): void }) {
  const result = useSplat(url);
  const view = getSplatView(result.asset?.resource);

  useEffect(() => result.subscribe(({ progress }) => onStatus({ loading: true, progress, error: null })), [result.subscribe, onStatus]);
  useEffect(() => onStatus({ loading: result.loading, progress: result.loading ? 0 : 1, error: result.error }), [result.loading, result.error, onStatus]);

  return (
    <>
      {result.asset && (
        <Entity rotation={[0, 0, 180]}>
          <GSplat asset={result.asset} key={result.asset.id} unified />
        </Entity>
      )}
      {result.asset && <ViewerCamera view={view} />}
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
