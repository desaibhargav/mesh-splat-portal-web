import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Vec3 } from "playcanvas";
import { useSurfacePick } from "../picking/useSurfacePick";
import { unpackSelection } from "../selection/SelectionHistory";
import { decodeColor } from "../selection/selectionColors";
import { focusSelection } from "../selection/focusSelection";
import { snapshotContains } from "../selection/selectionSnapshot";
import type { SelectionHandle, SelectionState } from "../selection/types";
import { AnnotationLayer } from "./AnnotationLayer";
import { type Annotations, type AnnotationDraft, type AnnotationRecord } from "./Annotations";
import { useSelectionAreaPick } from "./useSelectionAreaPick";

const newDraft = (): AnnotationDraft => ({ title: "", text: "", position: null, region: null, color: null });
type AnnotationKind = "selection" | "point";
type AnnotationStep = "choose" | "selection" | "marker" | "details" | "drag" | null;

export function AnnotationControls({ handle, annotations, active, interactive, hoverRegions, onChange, onRestore }: {
  handle: SelectionHandle; annotations: Annotations; active: boolean; interactive: boolean; hoverRegions: boolean;
  onChange(): void; onRestore(state: SelectionState): void;
}) {
  const [, refresh] = useState(0);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const [kind, setKind] = useState<AnnotationKind | null>(null);
  const [step, setStep] = useState<AnnotationStep>(null);
  const redraw = () => refresh(value => value + 1);

  function createAnnotation() { setDraft(newDraft()); setKind(null); setStep("choose"); }
  function editAnnotation(record: AnnotationRecord) {
    setDraft({ ...record }); setKind(record.region ? "selection" : "point"); setStep("details");
  }
  function moveAnnotation(record: AnnotationRecord) {
    setDraft({ ...record }); setKind(record.region ? "selection" : "point"); setStep("drag");
  }
  function cancelAnnotation() { setDraft(null); setKind(null); setStep(null); }
  function removeAnnotation(id: number) {
    annotations.remove(id);
    if (draft?.id === id) cancelAnnotation();
    redraw(); onChange();
  }
  function saveAnnotation(event: FormEvent) {
    event.preventDefault();
    if (!draft?.position || step !== "details" || busy) return;
    annotations.save(draft); cancelAnnotation(); redraw(); onChange();
  }
  function chooseKind(next: AnnotationKind) {
    setDraft(newDraft()); setKind(next); setStep(next === "selection" ? "selection" : "marker");
  }
  function finishMove(id: number, position: Vec3) {
    if (!draft || (draft.id ?? 0) !== id) return;
    const moved = { ...draft, position };
    if (draft.id === undefined) { setDraft(moved); setStep("details"); return; }
    annotations.save(moved); cancelAnnotation(); redraw(); onChange();
  }

  useEffect(() => {
    if (active) createAnnotation();
    else cancelAnnotation();
  }, [handle, active]);

  const { busy, message } = useSurfacePick({
    handle,
    active: active && step === "marker",
    acceptsClick: () => !!draft,
    validateClick: async (u, v) => {
      if (kind !== "selection" || !draft?.region) return null;
      const hit = await handle.selection.primitiveAt(handle.app, handle.camera(), u, v);
      return hit && snapshotContains(draft.region, hit.part, hit.index) ? null : "Place the marker on the chosen selection.";
    },
    onPick: position => {
      setDraft(current => current && { ...current, position });
      setStep("details");
    }
  });
  const areaPick = useSelectionAreaPick(handle, active && step === "selection", area => {
    const color = area.color ? decodeColor(area.color) :
      getComputedStyle(handle.app.graphicsDevice.canvas).getPropertyValue("--gold").trim();
    setDraft(current => current && { ...current, region: area.snapshot, color });
    setStep("marker");
  });

  function restoreRegion(region: NonNullable<AnnotationDraft["region"]>) {
    onRestore(unpackSelection(region));
    const bounds = handle.selection.bounds();
    if (bounds) focusSelection(bounds, handle.camera());
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

  const status = busy ? "Picking surface…" : message ?? areaPick.error ?? ({
    choose: "Choose an annotation type",
    selection: areaPick.area ? `Click ${areaPick.area.name} to annotate it` : "Hover over a selection, then click it",
    marker: kind === "selection" ? "Click the chosen selection to place its marker" : "Click a surface to place the marker",
    details: "Enter a title and description",
    drag: "Drag the marker to a new surface"
  } as const)[step ?? "choose"];
  const displayedAnnotations = useMemo(() => {
    const preview = draft?.position ? { ...draft, id: draft.id ?? 0, title: draft.title.trim() || "New annotation",
      text: draft.text.trim(), position: draft.position, visible: true } satisfies AnnotationRecord : null;
    const records = annotations.records.flatMap(record => record.id === preview?.id ? [preview] : record.visible ? [record] : []);
    return preview && draft?.id === undefined ? [...records, preview] : records;
  }, [annotations.records, draft]);
  const choosing = step === "selection" || step === "marker";
  const hasSelections = handle.selection.areas.some(area => area.visible);

  return <>
    {displayedAnnotations.length > 0 && <AnnotationLayer handle={handle} records={displayedAnnotations}
      interactive={interactive && !choosing} hoverRegions={hoverRegions && !choosing}
      movingId={step === "drag" ? draft?.id ?? 0 : null} onMove={finishMove} />}
    {active && <div className="annotation-panels">
      {annotations.records.length > 0 && <div className="selection-actions annotation-list" role="group" aria-label="Saved annotations">
        <strong>Annotations</strong>
        <ol>{annotations.records.map((record, index) => <li key={record.id}>
          <button className="annotation-edit" onClick={() => editAnnotation(record)} title="Edit annotation">{index + 1}. {record.title}</button>
          <button aria-label={`Move annotation ${index + 1}`} title="Move marker"
            aria-pressed={step === "drag" && draft?.id === record.id} onClick={() => moveAnnotation(record)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg>
          </button>
          <button className="annotation-delete" aria-label={`Delete annotation ${index + 1}`} title="Delete annotation"
            onClick={() => removeAnnotation(record.id)}>−</button>
        </li>)}</ol>
      </div>}
      <div className="selection-actions annotation-actions" role="group" aria-label="Annotate">
        <strong>Annotate</strong>
        <span role="status">{status}</span>
        {step === "choose" && <div className="annotation-kinds">
          <button type="button" disabled={!hasSelections} onClick={() => chooseKind("selection")}>Annotate a selection</button>
          <button type="button" onClick={() => chooseKind("point")}>Annotate with a point</button>
        </div>}
        {(step === "selection" || step === "marker" || step === "drag") && <button type="button" onClick={cancelAnnotation}>Cancel</button>}
        {draft?.position && step === "details" && <form onSubmit={saveAnnotation}>
          <label>Title<input name="title" required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Description<textarea name="description" rows={3} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <button type="submit" disabled={!draft.title.trim() || busy}>Save annotation</button>
          <button type="button" disabled={!draft.region} onClick={() => draft.region && restoreRegion(draft.region)}>Focus on annotated area</button>
          <button type="button" onClick={cancelAnnotation}>Cancel</button>
        </form>}
        {!draft && <button type="button" onClick={createAnnotation}>New annotation</button>}
        <small>Annotations last until you leave this asset.</small>
      </div>
    </div>}
  </>;
}
