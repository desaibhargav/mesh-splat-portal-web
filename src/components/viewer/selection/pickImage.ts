import type { SelectionRegion } from "./types";

export interface PickImage {
  pixels: Uint8Array; left: number; top: number; width: number; height: number;
  screenWidth: number; screenHeight: number; flipY: boolean;
}

// PlayCanvas pickPS encodes uint IDs as R16/G8/B0/A24.
export function faceId(data: Uint8Array, pixel = 0): number {
  return (data[pixel + 2]! | data[pixel + 1]! << 8 | data[pixel]! << 16 | data[pixel + 3]! << 24) >>> 0;
}

export function regionAlpha(region: SelectionRegion): Uint8Array {
  const alpha = new Uint8Array(region.width * region.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = region.pixels[i * 4 + 3]!;
  return alpha;
}

// Pure readback decoding is shared by the UI's native picker and its worker.
// No renderer, canvas, or PlayCanvas runtime is imported into the worker here.
export function facesInMask(image: PickImage, alpha: Uint8Array, width: number, height: number, counts: number[]): Uint8Array[] {
  const masks = counts.map(count => new Uint8Array(count));
  let total = 0;
  const offsets = counts.map(count => { const start = total; total += count; return start; });
  for (let y = 0; y < image.height; y++) {
    const maskRow = Math.floor((image.top + y + .5) * height / image.screenHeight) * width;
    const row = (image.flipY ? image.height - 1 - y : y) * image.width;
    for (let x = 0; x < image.width; x++) {
      const maskX = Math.floor((image.left + x + .5) * width / image.screenWidth);
      if (!alpha[maskRow + maskX]) continue;
      const id = faceId(image.pixels, (row + x) * 4);
      if (id >= total) continue;
      let low = 0, high = counts.length;
      while (low + 1 < high) { const middle = (low + high) >>> 1; if (offsets[middle]! <= id) low = middle; else high = middle; }
      masks[low]![id - offsets[low]!] = 255;
    }
  }
  return masks;
}
