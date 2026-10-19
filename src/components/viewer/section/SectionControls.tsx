import { useEffect, useMemo, useState } from "react";
import type { BoundingBox } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { captureFrame, copyFrame, recallFrame, type NamedView, type ViewFrame } from "../views/viewFrame";
import { planeCoefficients, sectionFrame, setSectionPlane, type SectionOptions } from "./sectionPlane";
import { SectionGuide } from "./SectionGuide";

const initialOptions: SectionOptions = { offset: 0, tiltX: 0, tiltY: 0, flip: false };

export function SectionControls({ handle, active, views }: { handle: SelectionHandle; active: boolean; views: readonly NamedView[] }) {
  const [reference, setReference] = useState<ViewFrame | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [showPlane, setShowPlane] = useState(true);
  const [options, setOptions] = useState(initialOptions);
  const [referenceName, setReferenceName] = useState("Current view");
  // Bounds are measured only once, not while sliding or orbiting.
  const [bounds, setBounds] = useState<BoundingBox | null>(null);
  useEffect(() => {
    if (active && !reference) {
      setReference(captureFrame(handle.camera())); setBounds(handle.selection.bounds(null));
    }
  }, [active, reference, handle]);
  const frame = useMemo(() => reference && bounds ? sectionFrame(reference, bounds, options) : null, [reference, bounds, options]);
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
    handle.app.on("destroy", dispose);
    return dispose;
  }, [handle]);

  function useReference(frame: ViewFrame, name = "Current view") {
    setReference(copyFrame(frame)); setReferenceName(name); setOptions(initialOptions);
  }

  if (!active) return null;
  return <div className="selection-actions selection-options view-options section-options" role="group" aria-label="Section">
    <strong>Cross section</strong>
    <button aria-pressed={enabled} disabled={!frame} onClick={() => setEnabled(!enabled)}>{enabled ? "Disable section" : "Enable section"}</button>
    <button onClick={() => useReference(captureFrame(handle.camera()))}>Use current view</button>
    <output>Reference: {referenceName}</output>
    <label>Use saved reference<select aria-label="Section reference" value="" onChange={event => {
      const view = views.find(view => view.id === Number(event.target.value));
      if (view) useReference(view.frame, view.name);
    }}><option value="">Choose a saved view…</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
    <label>Offset <output>{Math.round(options.offset * 100)}%</output><input aria-label="Section offset" type="range" min="-100" max="100" value={options.offset * 100}
      onChange={event => setOptions({ ...options, offset: Number(event.target.value) / 100 })} /></label>
    {([{ key: "tiltX", label: "Tilt 1" }, { key: "tiltY", label: "Tilt 2" }] as const).map(({ key, label }) => <label key={key}>{label} <output>{options[key]}°</output>
      <input aria-label={label} type="range" min="-180" max="180" value={options[key]} onChange={event => setOptions({ ...options, [key]: Number(event.target.value) })} /></label>)}
    <button aria-pressed={options.flip} onClick={() => setOptions({ ...options, flip: !options.flip })}>Flip retained side</button>
    <button aria-pressed={showPlane} onClick={() => setShowPlane(!showPlane)}>Show cutting plane</button>
    <button disabled={!frame} onClick={() => frame && recallFrame(handle.camera(), frame)}>Align camera with plane</button>
    <button onClick={() => setOptions(initialOptions)}>Reset section position</button>
    <small>Q exits this tool; the section stays enabled.</small>
    {enabled && showPlane && frame && bounds && <SectionGuide handle={handle} frame={frame} extent={bounds.halfExtents.length()} />}
  </div>;
}
