import { Color, PROJECTION_ORTHOGRAPHIC, PIXELFORMAT_RGBA8, RenderPassPicker, RenderTarget, Texture, type AppBase, type CameraComponent, type Layer } from "playcanvas";

import { renderPickView } from "../picking/PickView";
import type { VisibilityTest } from "./types";

export interface DepthImage { values: Float32Array; width: number; height: number; near: number; far: number; orthographic: boolean }

// Release while the application and graphics device are still alive, including when
// navigation interrupts an asynchronous GPU readback.
export async function captureDepth(app: AppBase, camera: CameraComponent, layers: Layer[] = app.scene.layers.layerList): Promise<DepthImage> {
  const near = camera.nearClip, far = camera.farClip, orthographic = camera.projection === PROJECTION_ORTHOGRAPHIC;
  const device = app.graphicsDevice;
  const width = Math.max(1, Math.floor(device.width * camera.rect.z)), height = Math.max(1, Math.floor(device.height * camera.rect.w));
  const color = Texture.createDataTexture2D(device, "Selection IDs", width, height, PIXELFORMAT_RGBA8);
  const depth = Texture.createDataTexture2D(device, "Selection depth", width, height, PIXELFORMAT_RGBA8);
  const target = new RenderTarget({ colorBuffers: [color, depth], depth: true });
  const pass = new RenderPassPicker(device, app.renderer);
  let disposed = false;
  const release = () => {
    if (disposed) return;
    disposed = true;
    pass.destroy(); target.destroy(); color.destroy(); depth.destroy();
  };
  app.on("destroy", release);
  try {
    pass.init(target); pass.setClearColor(Color.WHITE); pass.depthStencilOps.clearDepth = true;
    pass.update(camera, app.scene, layers, new Map(), true);
    renderPickView(camera, () => pass.render());
    const pixels = await depth.read(0, 0, width, height, { immediate: true });
    if (disposed) throw new Error("Viewer closed during selection.");
    return { values: decodeDepth(pixels as Uint8Array, width, height, !device.isWebGPU), width, height, near, far, orthographic };
  } finally { app.off("destroy", release); release(); }
}

export function depthTest(depth: DepthImage): VisibilityTest {
  return (_id, u, v, w, cz) => {
    const front = depth.values[Math.floor(v * depth.height) * depth.width + Math.floor(u * depth.width)]!;
    const distance = depth.orthographic ? (cz / w + 1) / 2 : (w - depth.near) / (depth.far - depth.near);
    const tolerance = Math.max(Math.abs(distance) * 2 ** -20, w / ((depth.far - depth.near) * depth.height));
    return Number.isFinite(front) && distance <= front + tolerance;
  };
}

export function decodeDepth(pixels: Uint8Array, width: number, height: number, flipY: boolean): Float32Array {
  const values = new Float32Array(width * height);
  const bits = new Uint32Array(values.buffer);
  for (let y = 0; y < height; y++) {
    const row = (flipY ? height - 1 - y : y) * width;
    for (let x = 0; x < width; x++) {
      const offset = (row + x) * 4;
      bits[y * width + x] = ((pixels[offset]! << 24) | (pixels[offset + 1]! << 16) |
        (pixels[offset + 2]! << 8) | pixels[offset + 3]!) >>> 0;
    }
  }
  return values;
}
