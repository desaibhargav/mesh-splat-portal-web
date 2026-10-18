import { Color, PROJECTION_ORTHOGRAPHIC, PIXELFORMAT_RGBA8, RenderPassPicker, RenderTarget, Texture, type AppBase, type CameraComponent } from "playcanvas";

export interface DepthImage { values: Float32Array; width: number; height: number; near: number; far: number; orthographic: boolean }

// The same public render pass used by PlayCanvas Picker, with an owned depth attachment
// so a whole gesture needs one GPU readback rather than one read per selected element.
export async function captureDepth(app: AppBase, camera: CameraComponent): Promise<DepthImage> {
  const device = app.graphicsDevice;
  const width = device.width, height = device.height;
  const color = Texture.createDataTexture2D(device, "Selection IDs", width, height, PIXELFORMAT_RGBA8);
  const depth = Texture.createDataTexture2D(device, "Selection depth", width, height, PIXELFORMAT_RGBA8);
  const target = new RenderTarget({ colorBuffers: [color, depth], depth: true });
  const pass = new RenderPassPicker(device, app.renderer);
  try {
    pass.init(target);
    pass.setClearColor(Color.WHITE);
    pass.depthStencilOps.clearDepth = true;
    pass.update(camera, app.scene, app.scene.layers.layerList, new Map(), true);
    pass.render();
    const pixels = await depth.read(0, 0, width, height, { immediate: true });
    return { values: decodeDepth(pixels as Uint8Array, width, height, !device.isWebGPU), width, height,
      near: camera.nearClip, far: camera.farClip, orthographic: camera.projection === PROJECTION_ORTHOGRAPHIC };
  } finally {
    pass.destroy();
    target.destroy();
    color.destroy();
    depth.destroy();
  }
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
