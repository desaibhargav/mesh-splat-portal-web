import type { SelectionScope } from "./selectionScope";
import type { AppBase, BoundingBox, CameraComponent } from "playcanvas";
import type { ViewerViewports } from "../viewports/ViewerViewports";
import type { ViewerSpace } from "../ViewerSpace";
import type { PaintState } from "./selectionColors";
import type { SelectionOperation } from "./rectangle";

export type SelectionTool = "navigate" | "select" | "segment" | "measure" | "annotate" | "views" | "section" | "capture";
export type SelectionShape = "rectangle" | "lasso" | "brush";
export interface SelectionRegion { pixels: Uint8ClampedArray; width: number; height: number }
export interface SelectionSummary { selected: number; total: number; isolated: boolean }
export type SelectionCamera = Pick<CameraComponent, "projectionMatrix" | "viewMatrix">;
export interface SelectionState { masks: Uint8Array[]; isolated: boolean }
export interface SelectionSnapshot { masks: { bits: Uint8Array; length: number }[]; isolated: boolean }
export interface SelectionArea {
  // Gesture/paint regions remain drafts until explicitly saved.
  id: number; name: string; visible: boolean; snapshot: SelectionSnapshot; color: number; saved?: boolean;
}
export type VisibilityTest = (id: number, u: number, v: number, w: number, z: number) => boolean;
export interface SelectionController {
  updateSection(): void;
  readonly layers: readonly number[];
  primitiveAt(app: AppBase, camera: CameraComponent, u: number, v: number): Promise<{ part: number; index: number } | null>;
  hitTest(app: AppBase, camera: CameraComponent, region: SelectionRegion): Promise<Uint8Array[]>;
  readonly state: SelectionState;
  readonly colors: PaintState;
  readonly areas: readonly SelectionArea[];
  areaAt(part: number, index: number): SelectionArea | null;
  previewArea(area: SelectionArea | null): void;
  renameArea(id: number, name: string): SelectionSummary;
  setAreaVisible(id: number, visible: boolean): SelectionSummary;
  paint(color: number): SelectionSummary;
  restore(state: SelectionState, colors?: PaintState, areas?: readonly SelectionArea[], scope?: SelectionScope): SelectionSummary;
  // null measures the entire asset; omitted measures the current selection/object.
  bounds(state?: SelectionState | null): BoundingBox | null;
  readonly summary: SelectionSummary;
  select(region: SelectionRegion, operation: SelectionOperation, camera: SelectionCamera, hits?: Uint8Array[]): SelectionSummary;
  clear(): SelectionSummary;
  toggleIsolation(): SelectionSummary;
}
export interface SelectionHandle { app: AppBase; space: ViewerSpace; viewports: ViewerViewports; selection: SelectionController; camera(): CameraComponent }
