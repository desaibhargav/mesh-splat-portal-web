import { useEffect, useMemo, useState } from "react";
import type { BoundingBox } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { axisFrame, captureFrame, copyFrame, recallFrame, restoreView, type NamedView, type ViewAxis, type ViewFrame } from "../views/viewFrame";
import { planeCoefficients, sectionFrame, setSectionPlane, type SectionOptions } from "./sectionPlane";
import { SectionGuide } from "./SectionGuide";

const initialOptions: SectionOptions = { offset: 0, tiltX: 0, tiltY: 0, flip: false };

export function SectionControls({ handle, active, views }: { handle: SelectionHandle; active: boolean; views: readonly NamedView[] }) {
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
    if (value === "camera") { fromCamera(); return; }
    const view = views.find(view => String(view.id) === value);
    if (view) { restoreView(handle, view); useReference(view.frame, value); }
  }

  if (!active) return null;
  return <div className="selection-actions selection-options view-options section-options" role="group" aria-label="Section">
    <strong>Cross section</strong>
    <label>View<select aria-label="Section reference" value={source} onChange={event => chooseReference(event.target.value)}>
      <option value="camera">Current camera</option>
      {views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
      {source !== "camera" && !views.some(view => String(view.id) === source) && <option value={source}>Deleted view (captured)</option>}
    </select></label>
    <fieldset className="selection-shapes"><legend>Cutting-plane normal</legend>
      {(["view", "X", "Y", "Z"] as const).map(axis => <button key={axis} aria-pressed={alignment === axis}
        onClick={() => { setAlignment(axis); setOptions(initialOptions); }}>{axis === "view" ? "View" : axis}</button>)}
    </fieldset>
    <label>Offset <output>{Math.round(options.offset * 100)}%</output><input aria-label="Section offset" type="range" min="-100" max="100" value={options.offset * 100}
      onChange={event => setOptions({ ...options, offset: Number(event.target.value) / 100 })} /></label>
    {([{ key: "tiltX", label: "Tilt 1" }, { key: "tiltY", label: "Tilt 2" }] as const).map(({ key, label }) => <label key={key}>{label} <output>{options[key]}°</output>
      <input aria-label={label} type="range" min="-180" max="180" value={options[key]} onChange={event => setOptions({ ...options, [key]: Number(event.target.value) })} /></label>)}
    <div className="section-buttons">
      <button aria-pressed={enabled} disabled={!frame} onClick={() => setEnabled(!enabled)}>{enabled ? "Disable section" : "Enable section"}</button>
      <button aria-pressed={options.flip} onClick={() => setOptions({ ...options, flip: !options.flip })}>Flip retained side</button>
      <button aria-pressed={showPlane} onClick={() => setShowPlane(!showPlane)}>Show cutting plane</button>
      <button onClick={fromCamera}>From current camera</button>
      <button disabled={!frame} onClick={() => frame && recallFrame(handle.camera(), frame)}>Look perpendicular to cut</button>
      <button onClick={() => setOptions(initialOptions)}>Reset section position</button>
    </div>
    <small>Q exits this tool; the section stays enabled.</small>
    {enabled && showPlane && frame && bounds && <SectionGuide handle={handle} frame={frame} extent={bounds.halfExtents.length()} />}
  </div>;
}
