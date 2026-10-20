import type { SelectionRegion } from "./types";

export function regionBounds(region: SelectionRegion) {
  let left = region.width, top = region.height, right = 0, bottom = 0;
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) if (region.pixels[(y * region.width + x) * 4 + 3]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return { left, top, right, bottom };
}
