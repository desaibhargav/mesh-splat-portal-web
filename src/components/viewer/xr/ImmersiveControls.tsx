import { useEffect, useState, useSyncExternalStore } from "react";
import { XRTYPE_AR, XRTYPE_VR } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { ImmersiveViewer } from "./ImmersiveViewer";

export function ImmersiveControls({ handle, onActive }: { handle: SelectionHandle; onActive(active: boolean): void }) {
  const [viewer, setViewer] = useState<ImmersiveViewer | null>(null);
  useEffect(() => {
    const session = new ImmersiveViewer(handle); setViewer(session);
    return () => session.destroy();
  }, [handle]);
  return viewer && <SessionControls viewer={viewer} onActive={onActive} />;
}

function SessionControls({ viewer, onActive }: { viewer: ImmersiveViewer; onActive(active: boolean): void }) {
  useSyncExternalStore(callback => {
    viewer.on("change", callback); return () => { viewer.off("change", callback); };
  }, () => viewer.revision);
  useEffect(() => { onActive(viewer.active); }, [viewer.active, onActive]);
  const vr = viewer.available(XRTYPE_VR), ar = viewer.available(XRTYPE_AR);
  if (!vr && !ar && !viewer.error) return null;
  return <div className="immersive-controls" role="group" aria-label="Immersive viewing">
    {viewer.active ? <button onClick={() => viewer.end()}>Exit immersive view</button> : <>
      {vr && <button disabled={viewer.pending} onClick={() => viewer.start(XRTYPE_VR)}>Enter VR</button>}
      {ar && <button disabled={viewer.pending} onClick={() => viewer.start(XRTYPE_AR)}>View in your room</button>}
    </>}
    {viewer.pending && <span role="status">Starting immersive view…</span>}
    {!viewer.pending && <small>Left trigger: orbit · Right trigger: pan · Left stick: zoom · Grip: move · Right B: exit{ar ? " · In AR, point at a floor and press trigger to place" : ""}</small>}
    {viewer.error && <span role="alert">{viewer.error}</span>}
  </div>;
}
