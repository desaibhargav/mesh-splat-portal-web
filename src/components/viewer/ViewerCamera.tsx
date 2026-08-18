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

export function ViewerCamera({ view }: { view: ViewerView }) {
  return (
    <Entity name="Viewer camera" position={view.cameraPosition}>
      <Camera
        fov={view.fov ?? 45}
        nearClip={Math.max(view.radius / 1_000, 0.001)}
        farClip={Math.max(view.radius * 100, 1_000)}
      />
      <Script
        script={CameraControls}
        enableFly={false}
        focusPoint={view.focusPoint}
        focusDamping={0.85}
        moveDamping={0.85}
        rotateDamping={0.85}
        zoomDamping={0.85}
        zoomRange={new Vec2(Math.max(view.radius * 0.02, 0.01), Math.max(view.radius * 100, 100))}
      />
    </Entity>
  );
}

export function frameBounds(bounds: BoundingBox, transformCenter?: (center: Vec3) => Vec3): ViewerView {
  const focusPoint = transformCenter ? transformCenter(bounds.center.clone()) : bounds.center.clone();
  const radius = Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z, 0.01);
  return {
    cameraPosition: [focusPoint.x, focusPoint.y, focusPoint.z + radius * 3.3],
    focusPoint,
    radius
  };
}
