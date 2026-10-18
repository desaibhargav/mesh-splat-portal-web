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
