import { ASPECT_MANUAL, Vec4, type CameraComponent } from "playcanvas";

// Native picking renders a panel-sized target and unprojects local coordinates.
// Keep the original camera identity: unified splats cache sorting per camera.
// Restore its viewport synchronously, before the next scene render/readback.
export function renderPickView<T>(camera: CameraComponent, render: () => T): T {
  // Disabled query cameras are not registered with scene layers. Register only
  // for this synchronous native pick pass; never enable a scene camera across
  // asynchronous readback (which would render over the headset view).
  const attached = camera.layers.map(id => camera.system.app.scene.layers.getLayerById(id)).filter(layer => layer && !layer.cameras.includes(camera));
  for (const layer of attached) layer!.addCamera(camera);
  camera.onAppPrerender();
  const rect = camera.rect.clone(), scissor = camera.scissorRect.clone();
  const mode = camera.aspectRatioMode, aspect = camera.aspectRatio;
  camera.aspectRatioMode = ASPECT_MANUAL; camera.aspectRatio = aspect;
  camera.rect = new Vec4(0, 0, 1, 1); camera.scissorRect = camera.rect.clone();
  try { return render(); }
  finally {
    for (const layer of attached) layer!.removeCamera(camera);
    camera.rect = rect; camera.scissorRect = scissor;
    camera.aspectRatio = aspect; camera.aspectRatioMode = mode;
  }
}
