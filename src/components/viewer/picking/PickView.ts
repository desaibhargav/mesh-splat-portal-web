import { ASPECT_MANUAL, Vec4, type CameraComponent } from "playcanvas";

// Native picking renders a panel-sized target and unprojects local coordinates.
// Keep the original camera identity: unified splats cache sorting per camera.
// Restore its viewport synchronously, before the next scene render/readback.
export function renderPickView<T>(camera: CameraComponent, render: () => T): T {
  const rect = camera.rect.clone(), scissor = camera.scissorRect.clone();
  const mode = camera.aspectRatioMode, aspect = camera.aspectRatio;
  camera.aspectRatioMode = ASPECT_MANUAL; camera.aspectRatio = aspect;
  camera.rect = new Vec4(0, 0, 1, 1); camera.scissorRect = camera.rect.clone();
  try { return render(); }
  finally {
    camera.rect = rect; camera.scissorRect = scissor;
    camera.aspectRatio = aspect; camera.aspectRatioMode = mode;
  }
}
