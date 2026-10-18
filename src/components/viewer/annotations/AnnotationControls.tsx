import { useEffect, useState, type FormEvent } from "react";
import { useSurfacePick } from "../picking/useSurfacePick";
import { unpackSelection } from "../selection/SelectionHistory";
import { decodeColor } from "../selection/selectionColors";
import { focusSelection } from "../selection/focusSelection";
import type { SelectionHandle, SelectionState } from "../selection/types";
import { AnnotationLayer } from "./AnnotationLayer";
import { type Annotations, type AnnotationDraft, type AnnotationRecord } from "./Annotations";
import { useSelectionAreaPick } from "./useSelectionAreaPick";

const newDraft = (): AnnotationDraft => ({ title: "", text: "", position: null, region: null, color: null });

type AnnotationInteraction = "marker" | "selection" | null;

export function AnnotationControls({ handle, annotations, active, interactive, hoverRegions, onChange, onRestore }: {
  handle: SelectionHandle; annotations: Annotations; active: boolean; interactive: boolean; hoverRegions: boolean;
  onChange(): void; onRestore(state: SelectionState): void;
}) {
  const [, refresh] = useState(0);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const [interaction, setInteraction] = useState<AnnotationInteraction>(null);
  const redraw = () => refresh(value => value + 1);

  function createAnnotation() {
    setDraft(newDraft());
    setInteraction("marker");
  }
  function editAnnotation(record: AnnotationRecord) {
    setDraft({ ...record });
    setInteraction(null);
  }
  function moveAnnotation(record: AnnotationRecord) {
    setDraft({ ...record });
    setInteraction("marker");
  }
  function cancelAnnotation() {
    setDraft(null);
    setInteraction(null);
  }
  function removeAnnotation(id: number) {
    annotations.remove(id);
    if (draft?.id === id) cancelAnnotation();
    redraw(); onChange();
  }
  function saveAnnotation(event: FormEvent) {
    event.preventDefault();
    if (!draft?.position || interaction || busy) return;
    annotations.save(draft);
    cancelAnnotation();
    redraw(); onChange();
  }
  function chooseSelection() {
    if (!draft) return;
    setDraft({ ...draft, position: null });
    setInteraction("selection");
  }

  useEffect(() => {
    if (active) createAnnotation();
    else cancelAnnotation();
  }, [handle, active]);
  const { busy, message } = useSurfacePick({ handle, active: active && interaction === "marker",
    acceptsClick: () => !!draft,
    onPick: position => { setDraft(current => current && { ...current, position }); setInteraction(null); }
  });
  const areaPick = useSelectionAreaPick(handle, active && interaction === "selection", area => {
    const color = area.color ? decodeColor(area.color) :
      getComputedStyle(handle.app.graphicsDevice.canvas).getPropertyValue("--gold").trim();
    setDraft(current => current && { ...current, region: area.snapshot, color });
    setInteraction("marker");
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
      if (undo) { if (key.shiftKey) annotations.redo(); else annotations.undo(); cancelAnnotation(); redraw(); onChange(); }
      else {
        const bounds = handle.selection.bounds();
        if (bounds) focusSelection(bounds, handle.camera());
      }
    }
    frame.addEventListener("keydown", keyDown);
    return () => { frame.removeEventListener("keydown", keyDown); };
  }, [handle, active, annotations, busy]);
  const status = busy ? "Picking surface…" : message ?? areaPick.error ?? (
    interaction === "selection" ? areaPick.area ? "Click this selection to annotate it" : "Hover over a colored selection"
      : interaction === "marker" ? "Click a surface to place the marker"
        : draft?.position ? "Marker placed" : "Create an annotation"
  );

  return <>
    {annotations.records.some(record => record.visible) && <AnnotationLayer handle={handle} records={annotations.records.filter(record => record.visible)}
      interactive={interactive && !interaction} hoverRegions={hoverRegions && !interaction} />}
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
          <button type="button" disabled={busy || (!handle.selection.areas.length && !handle.selection.summary.selected)}
            onClick={chooseSelection}>Annotate a selection</button>
          {draft.region && <button type="button" onClick={restoreDraftRegion}>Select annotated area</button>}
          {draft.position && <button type="button" disabled={busy} onClick={() => setInteraction("marker")}>Move marker</button>}
          <button type="submit" disabled={!draft.title.trim() || !draft.position || !!interaction || busy}>Save annotation</button>
          <button type="button" onClick={cancelAnnotation}>Cancel</button>
        </form> : <button onClick={createAnnotation}>New annotation</button>}
        <small>Annotations last until you leave this asset.</small>
      </div>
    </div>}
  </>;
}
