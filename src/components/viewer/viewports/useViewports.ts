import { useSyncExternalStore } from "react";
import type { SelectionHandle } from "../selection/types";

export function useViewports(handle: SelectionHandle) {
  useSyncExternalStore(callback => {
    handle.viewports.on("change", callback);
    return () => { handle.viewports.off("change", callback); };
  }, () => handle.viewports.revision);
  return handle.viewports;
}
