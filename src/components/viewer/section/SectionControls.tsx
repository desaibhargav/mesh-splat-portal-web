import { useEffect, useId, useMemo, useState } from "react";
import type { BoundingBox } from "playcanvas";
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

export function SectionControls({ handle, active, views }: { handle: SelectionHandle; active: boolean; views: readonly NamedView[] }) {
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
        <button type="button" title={`Reset ${label.toLowerCase()}`} aria-label={`Reset ${label.toLowerCase()}`}
          disabled={options[key] === initialOptions[key]} onClick={() => setOptions({ ...options, [key]: initialOptions[key] })}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4v6h6M4 10a8 8 0 1 1 1 8" />
          </svg>
        </button>
      </div>
    </div>)}
    <div className="section-buttons">
      <button aria-pressed={enabled} disabled={!frame} onClick={() => setEnabled(!enabled)}>{enabled ? "Disable section" : "Enable section"}</button>
      <button aria-pressed={options.flip} onClick={() => setOptions({ ...options, flip: !options.flip })}>Flip retained side</button>
      <button aria-pressed={showPlane} onClick={() => setShowPlane(!showPlane)}>Show cutting plane</button>
      <button onClick={fromCamera}>From current camera</button>
      <button disabled={!frame} onClick={() => frame && recallFrame(handle.camera(), cutawayView(frame, options.flip))}>Look perpendicular to cut</button>
      <button onClick={() => setOptions(initialOptions)}>Reset section position</button>
    </div>
    <small>Q exits this tool; the section stays enabled.</small>
    {enabled && showPlane && frame && bounds && <SectionGuide handle={handle} frame={frame} extent={bounds.halfExtents.length()} />}
  </div>;
}
