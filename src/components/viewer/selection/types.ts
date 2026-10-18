import type { AppBase, CameraComponent } from "playcanvas";
import type { SelectionOperation } from "./rectangle";
import type { DepthImage } from "./SelectionDepth";

export type SelectionTool = "navigate" | "rectangle" | "lasso" | "brush";
export interface SelectionRegion { pixels: Uint8ClampedArray; width: number; height: number }
export interface SelectionSummary { selected: number; total: number; isolated: boolean }
export type SelectionCamera = Pick<CameraComponent, "projectionMatrix" | "viewMatrix">;
export interface SelectionController {
  readonly summary: SelectionSummary;
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, depth?: DepthImage): SelectionSummary;
  clear(): SelectionSummary;
  toggleIsolation(): SelectionSummary;
}
export interface SelectionHandle { app: AppBase; selection: SelectionController; camera(): CameraComponent }
