import type { AppBase, BoundingBox, CameraComponent } from "playcanvas";
import type { PaintState } from "./selectionColors";
import type { SelectionOperation } from "./rectangle";

export type SelectionTool = "navigate" | "rectangle" | "lasso" | "brush" | "measure" | "annotate";
export interface SelectionRegion { pixels: Uint8ClampedArray; width: number; height: number }
export interface SelectionSummary { selected: number; total: number; isolated: boolean }
export type SelectionCamera = Pick<CameraComponent, "projectionMatrix" | "viewMatrix">;
export interface SelectionState { masks: Uint8Array[]; isolated: boolean }
export type VisibilityTest = (id: number, u: number, v: number, w: number, z: number) => boolean;
export interface SelectionController {
  readonly layers: readonly number[];
  primitiveAt(app: AppBase, camera: CameraComponent, u: number, v: number): Promise<{ part: number; index: number } | null>;
  hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion): Promise<Uint8Array[]>;
  readonly state: SelectionState;
  readonly colors: PaintState;
  paint(color: number): SelectionSummary;
  restore(state: SelectionState, colors?: PaintState): SelectionSummary;
  bounds(): BoundingBox | null;
  readonly summary: SelectionSummary;
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, hits?: Uint8Array[]): SelectionSummary;
  clear(): SelectionSummary;
  toggleIsolation(): SelectionSummary;
}
export interface SelectionHandle { app: AppBase; selection: SelectionController; camera(): CameraComponent }
