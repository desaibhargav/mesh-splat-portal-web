import { SavedItems } from "../SavedItems";
import { SliderControl } from "../SliderControl";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { BoundingBox } from "playcanvas";
import type { SavedPresets } from "../presets/SavedPresets";
import type { SelectionHandle } from "../selection/types";
import { axisFrame, captureFrame, copyFrame, recallFrame, restoreView, type NamedView, type ViewAxis, type ViewFrame } from "../views/viewFrame";
import { cutawayView, planeCoefficients, sectionFrame, setSectionPlane, type SectionOptions } from "./sectionPlane";
import { SectionGuide } from "./SectionGuide";

const adjustments = [
  { key: "offset", label: "Offset", scale: 100, limit: 100, unit: "%" },
  { key: "tiltX", label: "Tilt 1", scale: 1, limit: 180, unit: "°" },
  { key: "tiltY", label: "Tilt 2", scale: 1, limit: 180, unit: "°" }
] as const;
const initialOptions: SectionOptions = { offset: 0, tiltX: 0, tiltY: 0, flip: false };

export interface NamedSection {
  id: number; name: string; view: NamedView; reference: ViewFrame; source: string;
  alignment: ViewAxis | "view"; options: SectionOptions;
}

export interface SectionSession {
  editing?: number | null; name?: string; reference?: ViewFrame | null; source?: string;
  alignment?: ViewAxis | "view"; enabled?: boolean; showPlane?: boolean; options?: SectionOptions;
}

export function SectionControls({ handle, active, views, sections, session, openRequest }: {
  openRequest: { id: number } | null;
  handle: SelectionHandle; active: boolean; views: readonly NamedView[]; sections: SavedPresets<NamedSection>; session: SectionSession;
}) {
  const [editing, setEditing] = useState<number | null>(session.editing ?? null);
  const [name, setName] = useState(session.name ?? "");
  const [reference, setReference] = useState<ViewFrame | null>(session.reference ?? null);
  const [source, setSource] = useState(session.source ?? "camera");
  const [alignment, setAlignment] = useState<ViewAxis | "view">(session.alignment ?? "view");
  const [enabled, setEnabled] = useState(session.enabled ?? false);
  const [showPlane, setShowPlane] = useState(session.showPlane ?? true);
  const [options, setOptions] = useState(session.options ?? initialOptions);
  const [bounds, setBounds] = useState<BoundingBox | null>(() => session.reference ? handle.selection.bounds(null) : null);
  const wasActive = useRef(false);
  const discardDraft = useEffectEvent(() => {
    const saved = sections.records.find(record => record.id === sections.activeId);
    if (saved) {
      applySection(saved); setName(saved.name); setEditing(saved.id);
    } else {
      setEnabled(false); setReference(null); setName(""); setEditing(null);
      setSource("camera"); setAlignment("view"); setOptions(initialOptions);
    }
  });
  useEffect(() => {
    if (wasActive.current && !active) discardDraft();
    wasActive.current = active;
  }, [active]);
  useEffect(() => {
    Object.assign(session, { editing, name, reference, source, alignment, enabled, showPlane, options });
  }, [session, editing, name, reference, source, alignment, enabled, showPlane, options]);
  useEffect(() => {
    if (active && !reference) fromCamera();
  }, [active, reference, handle]);
  useEffect(() => {
    const changed = () => setBounds(handle.selection.bounds(null));
    handle.space.on("change", changed);
    return () => { handle.space.off("change", changed); };
  }, [handle]);
  const frame = useMemo(() => reference && bounds ? sectionFrame(
    alignment === "view" ? reference : axisFrame(reference, alignment), bounds, options) : null,
  [reference, bounds, options, alignment]);
  const plane = useMemo(() => enabled && frame ? planeCoefficients(frame, options.flip) : null, [enabled, frame, options.flip]);
  useEffect(() => {
    setSectionPlane(handle.app, plane); handle.selection.updateSection();
  }, [handle, plane]);
  useEffect(() => {
    let disposed = false;
    const dispose = () => {
      if (disposed) return; disposed = true;
      handle.app.off("destroy", dispose); setSectionPlane(handle.app, null);
    };
    handle.app.on("destroy", dispose); return dispose;
  }, [handle]);

  function useReference(frame: ViewFrame, source: string) {
    setReference(copyFrame(frame)); setSource(source); setOptions(initialOptions); setAlignment("view");
    setBounds(handle.selection.bounds(null));
  }
  function fromCamera() { useReference(captureFrame(handle.camera()), "camera"); }
  function chooseReference(value: string) {
    const view = views.find(view => String(view.id) === value);
    if (view) { restoreView(handle, view); useReference(view.frame, value); }
  }
  function chooseAlignment(value: ViewAxis | "view") {
    const reset = { ...initialOptions };
    setAlignment(value); setOptions(reset);
    if (!reference || !bounds) return;
    const aligned = sectionFrame(value === "view" ? reference : axisFrame(reference, value), bounds, reset);
    handle.viewports.restorePerspective(cutawayView(aligned, reset.flip));
  }

  function applySection(section: NamedSection) {
    setReference(copyFrame(section.reference)); setSource(section.source);
    setAlignment(section.alignment); setOptions({ ...section.options });
    setBounds(handle.selection.bounds(null)); setEnabled(true);
  }
  const load = useEffectEvent((section: NamedSection) => {
    restoreView(handle, section.view); applySection(section);
    setName(section.name); setEditing(section.id);
  });
  const visibility = useEffectEvent((section: NamedSection | null) => {
    if (section) applySection(section); else setEnabled(false);
    setEditing(null); setName("");
  });
  const close = useEffectEvent(() => { setEnabled(false); setEditing(null); setName(""); });
  useEffect(() => {
    const saved = sections.records.find(record => record.id === sections.activeId);
    if (saved && !session.reference) visibility(saved);
    sections.on("open", load); sections.on("close", close); sections.on("visibility", visibility);
    return () => { sections.off("open", load); sections.off("close", close); sections.off("visibility", visibility); };
  }, [sections]);
  const savedName = sections.records.find(record => record.id === editing)?.name;
  useEffect(() => { if (savedName !== undefined) setName(savedName); }, [savedName]);
  useEffect(() => {
    if (active && openRequest) sections.open(openRequest.id);
  }, [active, openRequest, sections]);

  function save() {
    if (!reference || !name.trim()) return;
    sections.save({ id: editing ?? undefined, name: name.trim(), reference: copyFrame(reference), source, alignment, options: { ...options },
      view: { id: 0, name: "", frame: captureFrame(handle.camera()), assetRotation: handle.space.rotation } });
    setName(""); setEditing(null);
  }

  if (!active) return null;
  return <div className="annotation-panels section-panels">
    <SavedItems label="Sections" items={sections.records} selectedId={editing} className="section-list"
      onOpen={id => sections.open(id)} onRemove={id => sections.remove(id)} />
    <div className="selection-actions selection-options view-options section-options" role="group" aria-label="Section">
      <strong>Cross section</strong>
      <label>View<select aria-label="Section reference" value={source} disabled={!views.length} onChange={event => chooseReference(event.target.value)}>
        <option value="camera" disabled hidden>Current camera</option>
        {views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
        {source !== "camera" && !views.some(view => String(view.id) === source) && <option value={source} disabled hidden>Deleted view (captured)</option>}
      </select></label>
      <fieldset className="selection-shapes"><legend>Cutting-plane normal</legend>
        {(["view", "X", "Y", "Z"] as const).map(axis => <button key={axis} aria-pressed={alignment === axis}
          onClick={() => chooseAlignment(axis)}>{axis === "view" ? "View" : axis}</button>)}
      </fieldset>
      {adjustments.map(({ key, label, scale, limit, unit }) => <SliderControl key={key} label={label}
        ariaLabel={key === "offset" ? "Section offset" : label} min={-limit} max={limit} unit={unit}
        value={Math.round(options[key] * scale)} defaultValue={initialOptions[key] * scale}
        onChange={value => setOptions({ ...options, [key]: value / scale })} />)}
      <div className="section-buttons">
        <button aria-pressed={enabled} disabled={!frame} onClick={() => { if (enabled) sections.close(); else setEnabled(true); }}>{enabled ? "Disable section" : "Enable section"}</button>
        <button aria-pressed={options.flip} onClick={() => setOptions({ ...options, flip: !options.flip })}>Flip retained side</button>
        <button aria-pressed={showPlane} onClick={() => setShowPlane(!showPlane)}>Show cutting plane</button>
        <button onClick={fromCamera}>From current camera</button>
        <button disabled={!frame} onClick={() => frame && handle.viewports.restorePerspective(cutawayView(frame, options.flip))}>Look perpendicular to cut</button>
        <button className="tool-action-reset" onClick={() => setOptions(initialOptions)}>Reset section position</button>
      </div>
      <label>Section name<input aria-label="Section name" value={name} onChange={event => setName(event.target.value)} /></label>
      <button disabled={!enabled || !name.trim()} className="tool-action-save" onClick={save}>{editing === null ? "Save section" : "Update section"}</button>
      {editing !== null && <button onClick={() => { setEditing(null); setName(""); }}>New section</button>}
      <small>Saved sections last until you leave this asset. Q discards unsaved section changes.</small>
      {enabled && showPlane && frame && bounds && <SectionGuide handle={handle} frame={frame} extent={bounds.halfExtents.length()} />}
    </div>
  </div>;
}
