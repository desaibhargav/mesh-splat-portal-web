import { rectangleBetween, type Point } from "./rectangle";
import type { SelectionRegion, SelectionShape } from "./types";

// Canvas's path rasterizer supplies the same box/lasso/round-brush coverage
// for mouse and tracked-ray gestures. Geometry selection stays in the controller.
export function rasterizeGesture(shape: SelectionShape, path: readonly Point[], width: number, height: number, diameter: number): SelectionRegion {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = ctx.strokeStyle = "white";
  if (shape === "rectangle") {
    const r = rectangleBetween(path[0]!, path.at(-1)!);
    ctx.fillRect(r.start.x, r.start.y, r.end.x - r.start.x, r.end.y - r.start.y);
  } else {
    ctx.beginPath(); ctx.moveTo(path[0]!.x, path[0]!.y);
    for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
    if (shape === "lasso") { ctx.closePath(); ctx.fill("evenodd"); }
    else {
      ctx.lineWidth = diameter; ctx.lineCap = ctx.lineJoin = "round"; ctx.stroke();
      ctx.beginPath(); ctx.arc(path[0]!.x, path[0]!.y, diameter / 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height };
}
