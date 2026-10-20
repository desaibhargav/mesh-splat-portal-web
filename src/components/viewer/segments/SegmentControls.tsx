import { useEffect, useState, type ReactNode } from "react";
import { SavedItems } from "../SavedItems";
import { useSelectionAreaPick } from "../annotations/useSelectionAreaPick";
import { packSelection } from "../selection/selectionSnapshot";
import type { SelectionHandle, SelectionSnapshot } from "../selection/types";
import type { SegmentWorkspaces } from "./SegmentWorkspaces";

export function SegmentControls({ handle, workspaces, active, seed, drawing, onDraw, disabled, children }: {
  handle: SelectionHandle; workspaces: SegmentWorkspaces; active: boolean; disabled: boolean;
  seed: SelectionSnapshot | null; drawing: boolean; onDraw(value: boolean): void; children: ReactNode;
}) {
  const [step, setStep] = useState<"choose" | "selection" | "details">("choose");
  const [region, setRegion] = useState<SelectionSnapshot | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const document = workspaces.current;
  const pick = useSelectionAreaPick(handle, active && step === "selection", area => {
    setRegion(area.snapshot); setName(area.name); setStep("details");
  });
  useEffect(() => {
    setStep(seed ? "details" : "choose"); setRegion(seed); setName(!seed && document.id ? document.name : ""); setError(null); onDraw(false);
  }, [active, seed]);
  useEffect(() => { if (document.id) setName(document.name); }, [document.id, document.name]);
  if (!active) return null;
  function cancel() { onDraw(false); setStep("choose"); setRegion(null); setName(document.id ? document.name : ""); setError(null); }
  function draw() {
    handle.selection.clear(); setRegion(null); setName(""); setStep("details"); onDraw(true);
  }
  function save() {
    try {
      const snapshot = drawing ? packSelection(handle.selection.state) : region;
      if (snapshot) workspaces.create(name, snapshot);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  const canSave = !!name.trim() && (drawing ? handle.selection.summary.selected > 0 : !!region);
  return <div className="annotation-panels segment-panels">
    <SavedItems label="Segments" items={workspaces.records} selectedId={document.id} className="segment-list" disabled={disabled}
      onOpen={id => workspaces.open(id)} onRemove={id => workspaces.remove(id)} />
    <div className="selection-actions segment-options" role="group" aria-label="Segment">
      <strong>Segment</strong>
      {document.id !== 0 && step === "choose" && <>
        <label>Segment name<input aria-label="Segment name" value={name} onChange={event => setName(event.target.value)} /></label>
        <button disabled={disabled || !name.trim()} onClick={() => workspaces.rename(document.id, name)}>Update segment</button>
      </>}
      {step === "choose" && <>
        <button disabled={disabled} onClick={draw}>New segment</button>
        <button disabled={disabled || !handle.selection.areas.some(area => area.visible)} onClick={() => setStep("selection")}>From existing selection</button>
      </>}
      {step === "selection" && <span role="status">{pick.error ?? (pick.area ? `Click ${pick.area.name} to create a segment` : "Hover over a selection, then click it")}</span>}
      {step === "details" && <>
        {drawing && children}
        <label>Segment name<input aria-label="Segment name" value={name} onChange={event => setName(event.target.value)} /></label>
        <button disabled={disabled || !canSave} onClick={save}>Save segment</button>
      </>}
      {step !== "choose" && <button onClick={cancel}>Cancel</button>}
      {error && <span role="alert">{error}</span>}
      <small>Segment edits stay in this workspace until you leave the asset.</small>
    </div>
  </div>;
}
