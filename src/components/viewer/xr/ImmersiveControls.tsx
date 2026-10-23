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
    {viewer.active ? <button aria-label="Exit immersive view" title="Exit immersive view" onClick={() => viewer.end()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M12 7v10m-4-4 4 4 4-4" /></svg>
    </button> : <>
      {vr && <button aria-label="View in VR" title="View in VR" disabled={viewer.pending} onClick={() => viewer.start(XRTYPE_VR)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 4 8h16l1 2.5v6a2 2 0 0 1-2 2h-2.5l-2-3h-5l-2 3H5a2 2 0 0 1-2-2zM7 12h3m4 0h3" /></svg>
      </button>}
      {ar && <button aria-label="View in your room" title="View in your room" disabled={viewer.pending} onClick={() => viewer.start(XRTYPE_AR)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M12 6l5 3v6l-5 3-5-3V9zm0 0v6m-5-3 5 3 5-3m-5 3v6" /></svg>
      </button>}
    </>}
    {viewer.pending && <span role="status">Starting immersive view…</span>}
    {viewer.error && <span role="alert">{viewer.error}</span>}
  </div>;
}
