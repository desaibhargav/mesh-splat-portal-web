import { useEffect, useMemo, useState } from "react";
import { useSurfacePick } from "../picking/useSurfacePick";
import { packSelection, unpackSelection } from "../selection/SelectionHistory";
import { focusSelection } from "../selection/focusSelection";
import type { SelectionHandle, SelectionState } from "../selection/types";
import { AnnotationLayer } from "./AnnotationLayer";
import { Annotations, type AnnotationDraft } from "./Annotations";

export function AnnotationControls({ handle, active, interactive, onActiveChange, onRestore }: {
  handle: SelectionHandle; active: boolean; interactive: boolean; onActiveChange(active: boolean): void;
  onRestore(state: SelectionState): void;
}) {
  const annotations = useMemo(() => new Annotations(), [handle]);
  const [, refresh] = useState(0);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const redraw = () => refresh(value => value + 1);
  function fromSelection(): AnnotationDraft | null {
    if (!handle.selection.summary.selected) return null;
    const bounds = handle.selection.bounds();
    return bounds ? { title: "", text: "", position: bounds.center.clone(), region: packSelection(handle.selection.state) } : null;
  }
  useEffect(() => {
    setDraft(active ? fromSelection() : null);
  }, [handle, active]);
  const { busy, message } = useSurfacePick({ handle, active: active && !draft, onActiveChange,
    acceptsClick: () => true,
    onPick: position => setDraft({ title: "", text: "", position, region: null })
  });
  useEffect(() => {
    if (!active) return;
    const frame = (handle.app.graphicsDevice.canvas as HTMLCanvasElement).closest(".viewer-frame")!;
    function keyDown(event: Event) {
      const key = event as KeyboardEvent;
      if (key.repeat || key.altKey || (key.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const undo = (key.metaKey || key.ctrlKey) && key.key.toLowerCase() === "z";
      const focus = !key.metaKey && !key.ctrlKey && key.key.toLowerCase() === "f";
      if (!undo && !focus) return;
      key.preventDefault(); key.stopPropagation();
      if (busy) return;
      if (undo) { if (key.shiftKey) annotations.redo(); else annotations.undo(); setDraft(null); redraw(); }
      else {
        const bounds = handle.selection.bounds();
        if (bounds) focusSelection(bounds, handle.camera());
      }
    }
    frame.addEventListener("keydown", keyDown);
    return () => { frame.removeEventListener("keydown", keyDown); };
  }, [handle, active, annotations, busy]);
  return <>
    {annotations.records.length > 0 && <AnnotationLayer handle={handle} records={annotations.records} interactive={interactive} />}
    {active && <div className="selection-actions annotation-actions" role="group" aria-label="Annotations">
      <span role="status">{busy ? "Picking surface…" : message ?? (draft ? draft.region ? "Annotate selected area" : "Annotate surface point" : "Click a surface to place an annotation")}</span>
      {draft ? <form onSubmit={event => { event.preventDefault(); annotations.save(draft); setDraft(null); redraw(); }}>
        <label>Title<input name="title" autoFocus required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Note<textarea name="note" rows={3} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
        <button type="submit" disabled={!draft.title.trim()}>Save annotation</button>
        {draft.region && <button type="button" onClick={() => {
          onRestore(unpackSelection(draft.region!));
          const bounds = handle.selection.bounds();
          if (bounds) focusSelection(bounds, handle.camera());
        }}>Select annotated area</button>}
        {draft.id !== undefined && <button type="button" onClick={() => { annotations.remove(draft.id!); setDraft(null); redraw(); }}>Delete annotation</button>}
        <button type="button" onClick={() => setDraft(null)}>Cancel</button>
      </form> : <button disabled={busy || !handle.selection.summary.selected} onClick={() => setDraft(fromSelection())}>Annotate selection</button>}
      {draft?.region && <button onClick={() => setDraft(null)}>Place point instead</button>}
      {annotations.records.length > 0 && <ol aria-label="Saved annotations">{annotations.records.map(record =>
        <li key={record.id}><button onClick={() => setDraft({ ...record })} title="Edit annotation">{record.id}. {record.title}</button></li>
      )}</ol>}
      <small>Annotations last until you leave this asset.</small>
    </div>}
  </>;
}
