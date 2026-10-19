import { useMemo } from "react";
import type { SelectionHandle } from "../selection/types";
import type { Viewport } from "./ViewerViewports";

// State and operations stay shared; a camera-facing visual binds to one panel.
export function useViewportHandle(handle: SelectionHandle, panel: Viewport): SelectionHandle {
  return useMemo(() => ({ ...handle, camera: () => panel.camera }), [handle, panel]);
}
