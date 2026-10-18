import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSurfacePick } from "../picking/useSurfacePick";
import { packSelection, unpackSelection } from "../selection/SelectionHistory";
import { selectionShade } from "../selection/selectionColors";
import { focusSelection } from "../selection/focusSelection";
import type { SelectionHandle, SelectionState } from "../selection/types";
import { AnnotationLayer } from "./AnnotationLayer";
import { Annotations, type AnnotationDraft, type AnnotationRecord } from "./Annotations";

const newDraft = (): AnnotationDraft => ({ title: "", text: "", position: null, region: null, color: null });

export function AnnotationControls({ handle, active, interactive, onActiveChange, onRestore }: {
  handle: SelectionHandle; active: boolean; interactive: boolean; onActiveChange(active: boolean): void;
  onRestore(state: SelectionState): void;
}) {
  const annotations = useMemo(() => new Annotations(), [handle]);
  const [, refresh] = useState(0);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const [placing, setPlacing] = useState(false);
  const redraw = () => refresh(value => value + 1);

  function createAnnotation() {
    setDraft(newDraft());
    setPlacing(true);
  }
  function editAnnotation(record: AnnotationRecord) {
    setDraft({ ...record });
    setPlacing(false);
  }
  function moveAnnotation(record: AnnotationRecord) {
    setDraft({ ...record });
    setPlacing(true);
  }
  function cancelAnnotation() {
    setDraft(null);
    setPlacing(false);
  }
  function removeAnnotation(id: number) {
    annotations.remove(id);
    if (draft?.id === id) cancelAnnotation();
    redraw();
  }
  function saveAnnotation(event: FormEvent) {
    event.preventDefault();
    if (!draft?.position || placing || busy) return;
    annotations.save(draft);
    cancelAnnotation();
    redraw();
  }
  function toggleSelectedArea() {
    if (!draft) return;
    const region = draft.region ? null : packSelection(handle.selection.state);
    const color = region ? selectionShade(
      handle.selection.colors,
      handle.selection.state.masks,
      getComputedStyle(handle.app.graphicsDevice.canvas).getPropertyValue("--gold").trim()
    ) : null;
    setDraft({ ...draft, region, color });
  }

  useEffect(() => {
    if (active) createAnnotation();
    else cancelAnnotation();
  }, [handle, active]);
  const { busy, message } = useSurfacePick({ handle, active: active && placing, onActiveChange,
    acceptsClick: () => !!draft,
    onPick: position => { setDraft(current => current && { ...current, position }); setPlacing(false); }
  });
  function restoreRegion(region: NonNullable<AnnotationDraft["region"]>) {
    onRestore(unpackSelection(region));
    const bounds = handle.selection.bounds();
    if (bounds) focusSelection(bounds, handle.camera());
  }
  function restoreDraftRegion() {
    if (draft?.region) restoreRegion(draft.region);
  }
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
      if (undo) { if (key.shiftKey) annotations.redo(); else annotations.undo(); setDraft(null); setPlacing(false); redraw(); }
      else {
        const bounds = handle.selection.bounds();
        if (bounds) focusSelection(bounds, handle.camera());
      }
    }
    frame.addEventListener("keydown", keyDown);
    return () => { frame.removeEventListener("keydown", keyDown); };
  }, [handle, active, annotations, busy]);
  const status = busy ? "Picking surface…" : message ?? (
    placing ? "Click a surface to place the marker" : draft?.position ? "Marker placed" : "Create an annotation"
  );

  return <>
    {annotations.records.length > 0 && <AnnotationLayer handle={handle} records={annotations.records} interactive={interactive && !placing} />}
    {active && <div className="annotation-panels">
      {annotations.records.length > 0 && <div className="selection-actions annotation-list" role="group" aria-label="Saved annotations">
        <strong>Annotations</strong>
        <ol>{annotations.records.map((record, index) => <li key={record.id}>
          <button className="annotation-edit" onClick={() => editAnnotation(record)} title="Edit annotation">{index + 1}. {record.title}</button>
          <button aria-label={`Move annotation ${index + 1}`} title="Move marker" onClick={() => moveAnnotation(record)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg>
          </button>
          <button className="annotation-delete" aria-label={`Delete annotation ${index + 1}`} title="Delete annotation"
            onClick={() => removeAnnotation(record.id)}>−</button>
        </li>)}</ol>
      </div>}
      <div className="selection-actions annotation-actions" role="group" aria-label="Annotate">
        <strong>Annotate</strong>
        <span role="status">{status}</span>
        {draft ? <form onSubmit={saveAnnotation}>
          <label>Title<input name="title" required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Note<textarea name="note" rows={3} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <button type="button" aria-pressed={!!draft.region} disabled={busy || (!draft.region && !handle.selection.summary.selected)}
            onClick={toggleSelectedArea}>Annotate selected area</button>
          {draft.region && <button type="button" onClick={restoreDraftRegion}>Select annotated area</button>}
          {draft.position && <button type="button" disabled={busy} onClick={() => setPlacing(true)}>Move marker</button>}
          <button type="submit" disabled={!draft.title.trim() || !draft.position || placing || busy}>Save annotation</button>
          <button type="button" onClick={cancelAnnotation}>Cancel</button>
        </form> : <button onClick={createAnnotation}>New annotation</button>}
        <small>Annotations last until you leave this asset.</small>
      </div>
    </div>}
  </>;
}
