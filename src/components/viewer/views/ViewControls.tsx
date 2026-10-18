import { useEffect, useState } from "react";
import type { SelectionHandle } from "../selection/types";
import { ViewGizmo, type ViewTransform } from "./ViewGizmo";
import { captureFrame, copyFrame, recallFrame, type NamedView, type ViewFrame } from "./viewFrame";

export function ViewControls({ handle, active }: { handle: SelectionHandle; active: boolean }) {
  const [frame, setFrame] = useState<ViewFrame | null>(null);
  const [mode, setMode] = useState<ViewTransform>("rotate");
  const [name, setName] = useState("");
  const [views, setViews] = useState<NamedView[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    if (active && !frame) setFrame(captureFrame(handle.camera()));
  }, [handle, active, frame]);
  useEffect(() => {
    if (!active || !frame) return;
    const gizmo = new ViewGizmo(handle, frame, mode, setFrame);
    return () => gizmo.destroy();
  }, [handle, active, frame, mode]);

  function captureCurrentView() { setFrame(captureFrame(handle.camera())); }
  function save() {
    if (!frame || !name.trim()) return;
    const id = editing ?? Math.max(0, ...views.map(view => view.id)) + 1;
    const record = { id, name: name.trim(), frame: copyFrame(frame) };
    setViews(previous => editing === null ? [...previous, record] : previous.map(view => view.id === id ? record : view));
    setEditing(id);
  }
  function open(view: NamedView) {
    setEditing(view.id); setName(view.name); setFrame(copyFrame(view.frame));
    recallFrame(handle.camera(), view.frame);
  }
  function remove(id: number) {
    setViews(previous => previous.filter(view => view.id !== id));
    if (editing === id) { setEditing(null); setName(""); }
  }
  function create() { setEditing(null); setName(""); captureCurrentView(); }

  if (!active) return null;
  return <div className="selection-actions selection-options view-options" role="group" aria-label="Views">
    <strong>Views</strong>
    <p>Move or rotate the reference plane. The model stays unchanged.</p>
    <fieldset className="selection-shapes">
      <legend>Reference frame</legend>
      <button aria-pressed={mode === "move"} onClick={() => setMode("move")}>Move</button>
      <button aria-pressed={mode === "rotate"} onClick={() => setMode("rotate")}>Rotate</button>
    </fieldset>
    <button onClick={captureCurrentView}>Use current view</button>
    <button disabled={!frame} onClick={() => frame && recallFrame(handle.camera(), frame)}>Look along reference</button>
    <label>View name<input aria-label="View name" value={name} onChange={event => setName(event.target.value)} /></label>
    <button disabled={!frame || !name.trim()} onClick={save}>{editing === null ? "Save view" : "Update view"}</button>
    <button onClick={create}>New view</button>
    {views.length > 0 && <ul aria-label="Saved views">{views.map(view => <li key={view.id}>
      <button aria-label={`Recall ${view.name}`} onClick={() => open(view)}>{view.name}</button>
      <button className="annotation-delete" aria-label={`Delete view ${view.name}`} onClick={() => remove(view.id)}>−</button>
    </li>)}</ul>}
    <small>Views last until you leave this asset.</small>
  </div>;
}
