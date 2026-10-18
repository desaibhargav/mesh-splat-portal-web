import { memo, useEffect, useState } from "react";
import { Entity } from "@playcanvas/react";
import { Camera, Script } from "@playcanvas/react/components";
import { Vec2, Vec3, type BoundingBox } from "playcanvas";
import { CameraControls } from "playcanvas/scripts/esm/camera-controls.mjs";

export interface ViewerView {
  cameraPosition: [number, number, number];
  focusPoint: Vec3;
  radius: number;
  fov?: number;
}

export function ViewerCamera({ view, controlsEnabled = true }: { view: ViewerView; controlsEnabled?: boolean }) {
  const [controls, setControls] = useState<CameraControls | null>(null);
  useEffect(() => {
    if (!controls) return;
    controls.focusPoint = view.focusPoint;
    controls.zoomRange = new Vec2(Math.max(view.radius * 0.02, 0.01), Math.max(view.radius * 100, 100));
  }, [controls, view]);
  useEffect(() => { if (controls) controls.enabled = controlsEnabled; }, [controls, controlsEnabled]);
  return <CameraRig view={view} onControls={setControls} />;
}

// Keep the entity's declarative initial transform from overwriting an interactive camera
// position whenever a tool changes. Only a new asset view should rebuild this rig.
const CameraRig = memo(function CameraRig({ view, onControls }: {
  view: ViewerView; onControls(controls: CameraControls | null): void;
}) {
  return (
    <Entity name="Viewer camera" position={view.cameraPosition}>
      <Camera
        fov={view.fov ?? 45}
        nearClip={Math.max(view.radius / 1_000, 0.001)}
        farClip={Math.max(view.radius * 100, 1_000)}
      />
      <Script
        script={CameraControls}
        ref={script => onControls(script as CameraControls | null)}
        enableFly={false}
        focusDamping={0.85}
        moveDamping={0.85}
        rotateDamping={0.85}
        zoomDamping={0.85}
      />
    </Entity>
  );
});

export function frameBounds(bounds: BoundingBox, transformCenter?: (center: Vec3) => Vec3): ViewerView {
  const focusPoint = transformCenter ? transformCenter(bounds.center.clone()) : bounds.center.clone();
  const radius = Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z, 0.01);
  return {
    cameraPosition: [focusPoint.x, focusPoint.y, focusPoint.z + radius * 3.3],
    focusPoint,
    radius
  };
}
