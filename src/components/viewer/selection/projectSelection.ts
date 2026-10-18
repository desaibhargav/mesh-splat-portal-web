import type { SelectionRegion, VisibilityTest } from "./types";
import type { SelectionOperation } from "./rectangle";

// Stable primitive IDs keep selections attached to geometry as the camera moves.
export function projectSelection(centers: Float32Array, mask: Uint8Array, matrix: ArrayLike<number>,
  region: SelectionRegion, operation: SelectionOperation, isolated: boolean, visible?: VisibilityTest): number {
  let count = 0;
  for (let i = 0; i < centers.length / 3; i++) {
    const x = centers[i * 3]!, y = centers[i * 3 + 1]!, z = centers[i * 3 + 2]!;
    const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
    const cx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
    const cy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
    const cz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
    const u = (cx / w + 1) / 2, v = (1 - cy / w) / 2;
    const previous = mask[i] !== 0;
    let hit = (!isolated || previous) && w > 0 && cz >= -w && cz <= w && u >= 0 && u < 1 && v >= 0 && v < 1 &&
      region.pixels[(Math.floor(v * region.height) * region.width + Math.floor(u * region.width)) * 4 + 3]! > 0;
    if (hit && visible) hit = visible(i, u, v, w, cz);
    const selected = operation === "set" ? hit : operation === "add" ? previous || hit :
      operation === "remove" ? previous && !hit : previous && hit;
    mask[i] = selected ? 255 : 0;
    if (selected) count++;
  }
  return count;
}
