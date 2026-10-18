import type { AppBase, BoundingBox, CameraComponent } from "playcanvas";
import type { SelectionOperation } from "./rectangle";

export type SelectionTool = "navigate" | "rectangle" | "lasso" | "brush";
export interface SelectionRegion { pixels: Uint8ClampedArray; width: number; height: number }
export interface SelectionSummary { selected: number; total: number; isolated: boolean }
export type SelectionCamera = Pick<CameraComponent, "projectionMatrix" | "viewMatrix">;
export interface SelectionState { masks: Uint8Array[]; isolated: boolean }
export type VisibilityTest = (id: number, u: number, v: number, w: number, z: number) => boolean;
export interface SelectionController {
  visibility(app: AppBase, camera: CameraComponent): Promise<VisibilityTest[]>;
  readonly state: SelectionState;
  restore(state: SelectionState): SelectionSummary;
  bounds(): BoundingBox | null;
  readonly summary: SelectionSummary;
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, visibility?: VisibilityTest[]): SelectionSummary;
  clear(): SelectionSummary;
  toggleIsolation(): SelectionSummary;
}
export interface SelectionHandle { app: AppBase; selection: SelectionController; camera(): CameraComponent }
