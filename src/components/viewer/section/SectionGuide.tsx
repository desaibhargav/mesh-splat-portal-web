import { useEffect, useRef } from "react";
import type { SelectionHandle } from "../selection/types";
import type { ViewFrame } from "../views/viewFrame";
import { SectionPlaneVisual } from "./SectionPlaneVisual";

export function SectionGuide({ handle, frame, extent }: { handle: SelectionHandle; frame: ViewFrame; extent: number }) {
  const visual = useRef<SectionPlaneVisual | null>(null);
  useEffect(() => {
    const guide = new SectionPlaneVisual(handle); visual.current = guide;
    let disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; handle.app.off("destroy", dispose); guide.destroy(); visual.current = null; };
    handle.app.on("destroy", dispose); return dispose;
  }, [handle]);
  useEffect(() => { visual.current?.update(frame, extent); }, [handle, frame, extent]);
  return null;
}
