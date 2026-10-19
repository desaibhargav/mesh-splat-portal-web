import { useEffect, useState } from "react";
import type { SelectionHandle } from "../selection/types";
import { ViewGizmo, type ViewTransform } from "./ViewGizmo";
import { axisFrame, captureFrame, copyFrame, recallFrame, type NamedView, type ViewAxis, type ViewFrame } from "./viewFrame";
import { ThreePointAlignment } from "./ThreePointAlignment";

export function ViewControls({ handle, active, views, onViewsChange }: {
  handle: SelectionHandle; active: boolean; views: NamedView[]; onViewsChange(views: NamedView[]): void;
}) {
  const [frame, setFrame] = useState<ViewFrame | null>(null);
  const [mode, setMode] = useState<ViewTransform>("rotate");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => { if (!active) setPicking(false); }, [active]);

  useEffect(() => {
    if (!active || picking) return;
    const viewer = handle.app.graphicsDevice.canvas.closest(".viewer-frame")!;
    function keyDown(event: Event) {
      const key = event as KeyboardEvent;
      if (key.repeat || key.ctrlKey || key.metaKey || key.altKey || (key.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const mode = key.key.toLowerCase() === "w" ? "move" : key.key.toLowerCase() === "e" ? "rotate" : null;
      if (mode) { key.preventDefault(); setMode(mode); }
    }
    viewer.addEventListener("keydown", keyDown);
    return () => viewer.removeEventListener("keydown", keyDown);
  }, [handle, active, picking]);

  useEffect(() => {
    if (active && !frame) setFrame(captureFrame(handle.camera()));
  }, [handle, active, frame]);
  useEffect(() => {
    if (!active || !frame || picking) return;
    const gizmo = new ViewGizmo(handle, frame, mode, setFrame);
    return () => gizmo.destroy();
  }, [handle, active, frame, mode, picking]);

  function captureCurrentView() { setFrame(captureFrame(handle.camera())); }
  function save() {
    if (!frame || !name.trim()) return;
    const id = editing ?? Math.max(0, ...views.map(view => view.id)) + 1;
    const record = { id, name: name.trim(), frame: copyFrame(frame) };
    onViewsChange(editing === null ? [...views, record] : views.map(view => view.id === id ? record : view));
    setEditing(id);
  }
  function open(view: NamedView) {
    setPicking(false);
    setEditing(view.id); setName(view.name); setFrame(copyFrame(view.frame));
    recallFrame(handle.camera(), view.frame);
  }
  function remove(id: number) {
    onViewsChange(views.filter(view => view.id !== id));
    if (editing === id) { setEditing(null); setName(""); }
  }
  function create() { setEditing(null); setName(""); captureCurrentView(); }

  if (!active) return null;
  return <div className="selection-actions selection-options view-options" role="group" aria-label="Views">
    <strong>Views</strong>
    <p>Move or rotate the reference plane. The model stays unchanged.</p>
    {picking && frame ? <ThreePointAlignment handle={handle} frame={frame}
      onAlign={aligned => { setFrame(aligned); setPicking(false); }} onCancel={() => setPicking(false)} /> : <>
      <fieldset className="selection-shapes"><legend>Align normal to axis</legend>
        {(["X", "Y", "Z"] as ViewAxis[]).map(axis => <button key={axis} disabled={!frame}
          onClick={() => frame && setFrame(axisFrame(frame, axis))}>{axis}</button>)}
      </fieldset>
      <button onClick={() => setPicking(true)}>Align to three points</button>
      <fieldset className="selection-shapes">
        <legend>Reference frame</legend>
        <button title="Move (W)" aria-keyshortcuts="W" aria-pressed={mode === "move"} onClick={() => setMode("move")}>Move</button>
        <button title="Rotate (E)" aria-keyshortcuts="E" aria-pressed={mode === "rotate"} onClick={() => setMode("rotate")}>Rotate</button>
      </fieldset>
      <button onClick={captureCurrentView}>Use current view</button>
      <button disabled={!frame} onClick={() => frame && recallFrame(handle.camera(), frame)}>Look along reference</button>
      <label>View name<input aria-label="View name" value={name} onChange={event => setName(event.target.value)} /></label>
      <button disabled={!frame || !name.trim()} onClick={save}>{editing === null ? "Save view" : "Update view"}</button>
      <button onClick={create}>New view</button>
    </>}
    {views.length > 0 && <ul aria-label="Saved views">{views.map(view => <li key={view.id}>
      <button aria-label={`Recall ${view.name}`} onClick={() => open(view)}>{view.name}</button>
      <button className="annotation-delete" aria-label={`Delete view ${view.name}`} onClick={() => remove(view.id)}>−</button>
    </li>)}</ul>}
    <small>Views last until you leave this asset.</small>
  </div>;
}
