// Rectangle gesture conventions and modifiers adapted from PlayCanvas SuperSplat.
// See public/licenses/supersplat.txt.
export interface Point { x: number; y: number }
export interface Rectangle { start: Point; end: Point }
export type SelectionOperation = "set" | "add" | "remove" | "intersect";

export function selectionOperation(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): SelectionOperation {
  const subtract = event.ctrlKey || event.metaKey;
  if (event.shiftKey && subtract) return "intersect";
  if (event.shiftKey) return "add";
  return subtract ? "remove" : "set";
}

export function rectangleBetween(a: Point, b: Point): Rectangle {
  return {
    start: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    end: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
  };
}

// Select Gaussian centers through the scene, using the camera captured at gesture completion.
// The matrix includes the entity transform; the mask remains indexed by original Gaussian ID.
export function selectCenters(
  centers: Float32Array, mask: Uint8Array, matrix: ArrayLike<number>,
  rectangle: Rectangle, operation: SelectionOperation, isolated: boolean
): number {
  const left = rectangle.start.x * 2 - 1;
  const right = rectangle.end.x * 2 - 1;
  const bottom = 1 - rectangle.end.y * 2;
  const top = 1 - rectangle.start.y * 2;
  let count = 0;
  for (let i = 0; i < centers.length / 3; i++) {
    const x = centers[i * 3]!;
    const y = centers[i * 3 + 1]!;
    const z = centers[i * 3 + 2]!;
    const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
    const cx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
    const cy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
    const cz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
    const previous = mask[i] !== 0;
    const hit = (!isolated || previous) && w > 0 && cz >= -w && cz <= w &&
      cx >= left * w && cx <= right * w && cy >= bottom * w && cy <= top * w;
    const selected = operation === "set" ? hit : operation === "add" ? previous || hit :
      operation === "remove" ? previous && !hit : previous && hit;
    mask[i] = selected ? 255 : 0;
    if (selected) count++;
  }
  return count;
}
