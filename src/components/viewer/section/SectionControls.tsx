import { ResetButton } from "../ResetButton";
import { useEffect, useEffectEvent, useId, useMemo, useState } from "react";
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

export function SectionControls({ handle, active, views, sections }: {
  handle: SelectionHandle; active: boolean; views: readonly NamedView[]; sections: SavedPresets<NamedSection>;
}) {
  const [name, setName] = useState("");
  const sliderId = useId();
  const [reference, setReference] = useState<ViewFrame | null>(null);
  const [source, setSource] = useState("camera");
  const [alignment, setAlignment] = useState<ViewAxis | "view">("view");
  const [enabled, setEnabled] = useState(false);
  const [showPlane, setShowPlane] = useState(true);
  const [options, setOptions] = useState(initialOptions);
  const [bounds, setBounds] = useState<BoundingBox | null>(null);
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

  const load = useEffectEvent((section: NamedSection) => {
    restoreView(handle, section.view);
    setReference(copyFrame(section.reference)); setSource(section.source);
    setAlignment(section.alignment); setOptions({ ...section.options });
    setBounds(handle.selection.bounds(null)); setName(section.name); setEnabled(true);
  });
  const close = useEffectEvent(() => setEnabled(false));
  useEffect(() => {
    sections.on("open", load); sections.on("close", close);
    return () => { sections.off("open", load); sections.off("close", close); };
  }, [sections]);
  function save() {
    if (!reference || !name.trim()) return;
    sections.save({ name: name.trim(), reference: copyFrame(reference), source, alignment, options: { ...options },
      view: { id: 0, name: "", frame: captureFrame(handle.camera()), assetRotation: handle.space.rotation } });
    setName("");
  }

  if (!active) return null;
  return <div className="selection-actions selection-options view-options section-options" role="group" aria-label="Section">
    <strong>Cross section</strong>
    <label>View<select aria-label="Section reference" value={source} disabled={!views.length} onChange={event => chooseReference(event.target.value)}>
      <option value="camera" disabled hidden>Current camera</option>
      {views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
      {source !== "camera" && !views.some(view => String(view.id) === source) && <option value={source} disabled hidden>Deleted view (captured)</option>}
    </select></label>
    <fieldset className="selection-shapes"><legend>Cutting-plane normal</legend>
      {(["view", "X", "Y", "Z"] as const).map(axis => <button key={axis} aria-pressed={alignment === axis}
        onClick={() => { setAlignment(axis); setOptions(initialOptions); }}>{axis === "view" ? "View" : axis}</button>)}
    </fieldset>
    {adjustments.map(({ key, label, scale, limit, unit }) => <div className="section-adjustment" key={key}>
      <div className="section-adjustment-heading">
        <label htmlFor={`${sliderId}-${key}`}>{label}</label><output>{Math.round(options[key] * scale)}{unit}</output>
      </div>
      <div className="section-adjustment-controls">
        <input id={`${sliderId}-${key}`} aria-label={key === "offset" ? "Section offset" : label} type="range" min={-limit} max={limit} value={options[key] * scale}
          onChange={event => setOptions({ ...options, [key]: Number(event.target.value) / scale })} />
        <ResetButton label={`Reset ${label.toLowerCase()}`} disabled={options[key] === initialOptions[key]}
          onClick={() => setOptions({ ...options, [key]: initialOptions[key] })} />
      </div>
    </div>)}
    <div className="section-buttons">
      <button aria-pressed={enabled} disabled={!frame} onClick={() => { if (enabled) sections.close(); else setEnabled(true); }}>{enabled ? "Disable section" : "Enable section"}</button>
      <button aria-pressed={options.flip} onClick={() => setOptions({ ...options, flip: !options.flip })}>Flip retained side</button>
      <button aria-pressed={showPlane} onClick={() => setShowPlane(!showPlane)}>Show cutting plane</button>
      <button onClick={fromCamera}>From current camera</button>
      <button disabled={!frame} onClick={() => frame && recallFrame(handle.camera(), cutawayView(frame, options.flip))}>Look perpendicular to cut</button>
      <button onClick={() => setOptions(initialOptions)}>Reset section position</button>
    </div>
    <label>Section name<input aria-label="Section name" value={name} onChange={event => setName(event.target.value)} /></label>
    <button disabled={!enabled || !name.trim()} onClick={save}>Save section</button>
    <small>Saved sections are in the model tree. Q exits this tool; the section stays enabled.</small>
    {enabled && showPlane && frame && bounds && <SectionGuide handle={handle} frame={frame} extent={bounds.halfExtents.length()} />}
  </div>;
}
