import { SliderControl } from "../SliderControl";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { SelectionHandle } from "../selection/types";
import { focusSelection } from "../selection/focusSelection";
import { formatDistance, Measurement } from "./Measurement";
import { MeasurementVisuals } from "./MeasurementVisuals";
import { defaultMeasurementStyle } from "./MeasurementRenderer";
import { MeasurementGizmos, type EndpointPreview } from "./MeasurementGizmos";
import { useSurfacePick } from "../picking/useSurfacePick";

const adjustments = [
  { key: "lineWidth", label: "Line width", min: 1, max: 8 },
  { key: "fontSize", label: "Font size", min: 10, max: 28 }
] as const;

export function MeasurementControls({ handle, measurement, active, onChange, openRequest }: {
  handle: SelectionHandle; measurement: Measurement; active: boolean; onChange(): void; openRequest: { id: number } | null;
}) {
  const [style, setStyle] = useState(measurement.style);
  useEffect(() => { measurement.style = style; }, [measurement, style]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EndpointPreview | null>(null);
  const gizmos = useRef<MeasurementGizmos | null>(null);
  const [, refresh] = useState(0);
  const redraw = () => { refresh(value => value + 1); onChange(); };
  const selected = measurement.records.find(record => record.id === selectedId);
  useEffect(() => { if (selected) setName(selected.name); }, [selected?.name]);
  function open(id: number) {
    const record = measurement.records.find(record => record.id === id)!;
    setSelectedId(id); setName(record.name); setEditError(null);
  }
  function remove(id: number) {
    measurement.remove(id);
    if (selectedId === id) setSelectedId(null);
    redraw();
  }
  function save() {
    if (!selected) return;
    measurement.save(selected.id, name); setSelectedId(null); setEditError(null); redraw();
  }
  function clearMeasurements() {
    measurement.clear(); setSelectedId(null); setEditError(null); clearMessage(); redraw();
  }
  const { busy: picking, message, clearMessage } = useSurfacePick({ handle, active,
    acceptsClick: shift => !editing && (shift || (!selected?.saved && (measurement.points.length < 2 || !!measurement.records.at(-1)?.saved))),
    onPick: (point, shift) => { measurement.add(handle.space.toLocal(point), shift || !!measurement.records.at(-1)?.saved); open(measurement.records.at(-1)!.id); redraw(); }
  });
  const committed = useEffectEvent(redraw);
  const editStatus = useEffectEvent((busy: boolean, error: string | null) => { setEditing(busy); setEditError(error); });
  useEffect(() => {
    if (!active) return;
    const handles = new MeasurementGizmos(handle, measurement, setPreview, committed, editStatus);
    gizmos.current = handles;
    return () => { handles.destroy(); gizmos.current = null; };
  }, [handle, measurement, active]);
  useEffect(() => { gizmos.current?.select(selected?.points.length === 2 ? selectedId : null); }, [selectedId, measurement.records, active]);
  useEffect(() => {
    if (!active) { setSelectedId(null); return; }
    const requested = measurement.records.find(record => record.id === openRequest?.id);
    if (requested) {
      measurement.setVisible(requested.id, true); open(requested.id); redraw();
      const bounds = measurement.bounds(requested.id);
      if (bounds) focusSelection(handle.space.worldBounds(bounds), handle.camera());
      return;
    }
    const draft = measurement.records.at(-1);
    if (draft && !draft.saved) open(draft.id);
    else setSelectedId(null);
  }, [active, openRequest]);
  const segments = useMemo(() => measurement.records.filter(record => record.visible).map(record =>
    record.id === preview?.id ? record.points.map((point, index) => index === preview.index ? preview.position : point) : record.points),
  [measurement.records, preview]);
  const currentPoints = preview && selected ? selected.points.map((point, index) => index === preview.index ? preview.position : point) : selected?.points;
  const distance = currentPoints?.length === 2 ? currentPoints[0]!.distance(currentPoints[1]!) : null;
  const busy = picking || editing;
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
      if (undo) { if (key.shiftKey) measurement.redo(); else measurement.undo(); redraw(); }
      else {
        const local = measurement.bounds();
        const bounds = local ? handle.space.worldBounds(local) : handle.selection.bounds(null);
        if (bounds) focusSelection(bounds, handle.camera());
      }
    }
    frame.addEventListener("keydown", keyDown);
    return () => { frame.removeEventListener("keydown", keyDown); };
  }, [handle, active, measurement, busy]);
  const instruction = !selected ? "Click the first surface point or choose a saved measurement" : selected.points.length === 1
    ? "Click the second surface point" : "Drag endpoint handles to adjust · Shift-click adds a measurement";
  const status = editing ? "Drag the endpoint along the surface" : picking ? "Picking surface…" : editError ?? message ?? instruction;
  return <>
    {measurement.records.length > 0 && <MeasurementVisuals handle={handle} segments={segments} style={style} />}
    {active && <div className="annotation-panels measurement-panels">
      {measurement.records.some(record => record.saved) && <div className="selection-actions annotation-list measurement-list" role="group" aria-label="Saved measurements">
        <strong>Measurements</strong>
        <ol>{measurement.records.filter(record => record.saved).map(record => <li key={record.id}>
          <button className="annotation-edit" disabled={busy} aria-pressed={selectedId === record.id} onClick={() => open(record.id)}>{record.name}</button>
          <button className="annotation-delete" disabled={busy} aria-label={`Delete measurement ${record.name}`} onClick={() => remove(record.id)}>−</button>
        </li>)}</ol>
      </div>}
      <div className="selection-actions measurement-actions" role="group" aria-label="Measurement">
      <span role="status">{status}</span>
      {distance !== null && <output aria-label="Measured distance">{formatDistance(distance)}</output>}
      {selected && <>
        <label>Measurement name<input aria-label="Measurement name" value={name} onChange={event => setName(event.target.value)} /></label>
        <button disabled={busy || selected.points.length !== 2 || !name.trim()} className="tool-action-save" onClick={save}>{selected.saved ? "Update measurement" : "Save measurement"}</button>
      </>}
      {adjustments.map(({ key, label, min, max }) => <SliderControl key={key} label={label} min={min} max={max} value={style[key]}
        onChange={value => setStyle(current => ({ ...current, [key]: value }))}
        defaultValue={defaultMeasurementStyle[key]} />)}
      <button disabled={busy || measurement.points.length === 0} className="tool-action-reset" onClick={clearMeasurements}>Clear measurements</button>
        <small>Measurements last until you leave this asset.</small>
      </div>
    </div>}
  </>;
}
