import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Quat } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { ViewGizmo } from "./ViewGizmo";
import { captureFrame, copyFrame, restoreView, type NamedView, type ViewFrame } from "./viewFrame";
import { ThreePointAlignment } from "./ThreePointAlignment";
import type { SavedPresets } from "../presets/SavedPresets";

export function ViewControls({ handle, active, views, openRequest }: {
  openRequest: { id: number } | null;
  handle: SelectionHandle; active: boolean; views: SavedPresets<NamedView>;
}) {
  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [frame, setFrame] = useState<ViewFrame | null>(null);
  const before = useRef<NamedView | null>(null);
  const savedName = views.records.find(record => record.id === editing)?.name;
  useEffect(() => { if (savedName !== undefined) setName(savedName); }, [savedName]);

  function snapshot(): NamedView {
    return { id: 0, name: "", frame: captureFrame(handle.camera()), assetRotation: handle.space.rotation };
  }
  function cancel() {
    if (before.current) restoreView(handle, before.current);
    before.current = null; setDrafting(false); setPicking(false);
  }
  // Exit cancels an unsaved draft; saved orientation survives tool switching.
  // Restore a cancelled draft before another tool applies its camera focus.
  useLayoutEffect(() => { if (!active) cancel(); }, [active]);
  useEffect(() => {
    if (!active || !drafting || picking) return;
    const gizmo = new ViewGizmo(handle);
    return () => gizmo.destroy();
  }, [handle, active, drafting, picking]);

  function create() {
    if (drafting) cancel();
    before.current = snapshot(); setFrame(before.current.frame);
    setEditing(null); setName(""); setPicking(false); setDrafting(true);
  }
  function open(view: NamedView) {
    if (drafting) cancel();
    before.current = snapshot(); restoreView(handle, view);
    setEditing(view.id); setName(view.name); setFrame(copyFrame(view.frame));
    setPicking(false); setDrafting(true);
  }
  const openRequested = useEffectEvent(open);
  useEffect(() => {
    views.on("open", openRequested);
    return () => { views.off("open", openRequested); };
  }, [views]);

  useEffect(() => {
    if (active && openRequest) views.open(openRequest.id);
  }, [active, openRequest, views]);

  function save() {
    if (!name.trim()) return;
    views.save({ ...snapshot(), id: editing ?? undefined, name: name.trim() });
    before.current = null; setDrafting(false); setPicking(false);
  }
  function remove(id: number) {
    if (editing === id) cancel();
    views.remove(id);
  }
  function align(aligned: ViewFrame) {
    handle.space.setRotation(aligned.rotation.clone().invert().mul(handle.space.rotation));
    setPicking(false);
  }

  if (!active) return null;
  return <>
    <div className="annotation-panels view-panels">
      {views.records.length > 0 && <div className="selection-actions view-options" role="group" aria-label="Saved views">
        <strong>Views</strong>
        <ul>{views.records.map(view => <li key={view.id}>
          <button aria-label={`Edit view ${view.name}`} onClick={() => open(view)}>{view.name}</button>
          <button className="annotation-delete" aria-label={`Delete view ${view.name}`} onClick={() => remove(view.id)}>−</button>
        </li>)}</ul>
      </div>}
      <div className="selection-actions view-options" role="group" aria-label="Views">
        <strong>{drafting ? editing === null ? "Create view" : "Edit view" : "Views"}</strong>
        {!drafting ? <button onClick={create}>Create view</button> : <>
          <label>View name<input aria-label="View name" value={name} onChange={event => setName(event.target.value)} /></label>
          {picking && frame ? <ThreePointAlignment handle={handle} frame={frame} onAlign={align} onCancel={() => setPicking(false)} /> : <>
            <p>Rotate the asset against the world grid. The current camera is saved with the view.</p>
            <button onClick={() => { setFrame(captureFrame(handle.camera())); setPicking(true); }}>Align to three points</button>
            <button className="tool-action-reset" onClick={() => handle.space.setRotation(Quat.IDENTITY)}>Reset orientation</button>
            <button disabled={!name.trim()} className="tool-action-save" onClick={save}>{editing === null ? "Save view" : "Update view"}</button>
            <button className="tool-action-reset" onClick={cancel}>Cancel</button>
          </>}
        </>}
        <small>Views last until you leave this asset.</small>
      </div>
    </div>
  </>;
}
