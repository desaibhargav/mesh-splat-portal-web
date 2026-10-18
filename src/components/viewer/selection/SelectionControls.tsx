import { AnnotationControls } from "../annotations/AnnotationControls";
import { Annotations } from "../annotations/Annotations";
import { MeasurementControls } from "../measurement/MeasurementControls";
import { Measurement } from "../measurement/Measurement";
import { ViewerTree, type ViewerTreeGroup } from "../ViewerTree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectionGesture } from "./SelectionGesture";
import type { SelectionHandle, SelectionRegion, SelectionTool } from "./types";
import type { SelectionOperation } from "./rectangle";
import { SelectionHistory, unpackSelection } from "./SelectionHistory";
import { encodeColor } from "./selectionColors";
import { SelectionColorPicker } from "./SelectionColorPicker";
import { focusSelection } from "./focusSelection";

const tools: { tool: SelectionTool; label: string; path: string }[] = [
  { tool: "navigate", label: "Navigate (Q)", path: "M5 3l14 10-7 1-3 7z" },
  { tool: "rectangle", label: "Rectangle select", path: "M4 4h16v16H4z" },
  { tool: "lasso", label: "Lasso select", path: "M9 18C1 17 1 5 12 4s14 12 3 14H9m0 0c-5 0-6 5-2 4 3-1 3-4 2-4z" },
  { tool: "brush", label: "Brush select", path: "M9 14L18 3l3 3-11 9m-1-1c-5-2-3 6-7 7 6 1 10-2 8-6z" },
  { tool: "measure", label: "Measure distance", path: "M3 16L16 3l5 5L8 21zM7 12l3 3m0-6 3 3m0-6 3 3" },
  { tool: "annotate", label: "Annotate", path: "M4 4h16v12H9l-5 5zM8 8h8m-8 4h5" }
];

export function SelectionControls({ handle, tool, onToolChange, disabled }: {
  handle: SelectionHandle | null; tool: SelectionTool; onToolChange(tool: SelectionTool): void; disabled: boolean;
}) {
  const [summary, setSummary] = useState(handle?.selection.summary);
  const [xray, setXray] = useState(false);
  const [brushSize, setBrushSize] = useState(32);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refreshDocument] = useState(0);
  const generation = useRef(0);
  const toolbar = useRef<HTMLDivElement>(null);
  const history = useMemo(() => handle ? new SelectionHistory(handle.selection) : null, [handle]);
  const measurement = useMemo(() => handle ? new Measurement() : null, [handle]);
  const annotations = useMemo(() => handle ? new Annotations() : null, [handle]);
  const documentChanged = useCallback(() => refreshDocument(value => value + 1), []);
  useEffect(() => {
    setSummary(handle?.selection.summary); setError(null); setBusy(false);
    return () => { generation.current++; };
  }, [handle]);
  const unavailable = disabled || !handle || busy;
  const selecting = tool !== "navigate" && tool !== "measure" && tool !== "annotate";
  useEffect(() => {
    const frame = toolbar.current?.closest(".viewer-frame");
    if (!frame || !handle || !history || (tool === "measure" || tool === "annotate")) return;
    const onKeyDown = (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.repeat || key.altKey || (key.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const undo = (key.metaKey || key.ctrlKey) && key.key.toLowerCase() === "z";
      const focus = !key.metaKey && !key.ctrlKey && key.key.toLowerCase() === "f";
      if (!undo && !focus) return;
      key.preventDefault(); key.stopPropagation();
      if (unavailable) return;
      if (undo) setSummary(key.shiftKey ? history.redo() : history.undo());
      else {
        const bounds = handle.selection.bounds();
        if (bounds) focusSelection(bounds, handle.camera());
      }
    };
    frame.addEventListener("keydown", onKeyDown);
    return () => frame.removeEventListener("keydown", onKeyDown);
  }, [handle, history, unavailable, tool]);
  const onSelect = useCallback(async (region: SelectionRegion, operation: SelectionOperation) => {
    if (!handle || !history) return;
    const token = generation.current;
    setBusy(true); setError(null);
    try {
      const camera = handle.camera();
      const view = { projectionMatrix: camera.projectionMatrix.clone(), viewMatrix: camera.viewMatrix.clone() };
      const hits = xray ? undefined : await handle.selection.hitTest(handle.app, camera, region);
      if (generation.current === token) {
        setSummary(history.perform(() => handle.selection.select(region, operation, view, hits)));
        documentChanged();
      }
    } catch (failure) {
      if (generation.current === token) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (generation.current === token) setBusy(false); }
  }, [handle, history, xray, documentChanged]);
  const groups: ViewerTreeGroup[] = handle && history && measurement && annotations ? [
    { id: "selections", label: "Selections", items: handle.selection.areas,
      onRename: (id, name) => { setSummary(history.perform(() => handle.selection.renameArea(id, name))); documentChanged(); },
      onVisible: (id, visible) => { setSummary(history.perform(() => handle.selection.setAreaVisible(id, visible))); documentChanged(); },
      onActivate: id => {
        const area = handle.selection.areas.find(item => item.id === id);
        if (!area) return;
        setSummary(history.perform(() => {
          handle.selection.setAreaVisible(id, true);
          return handle.selection.restore(unpackSelection(area.snapshot));
        }));
        documentChanged();
      } },
    { id: "measurements", label: "Measurements", items: measurement.records,
      onRename: (id, name) => { measurement.rename(id, name); documentChanged(); },
      onVisible: (id, visible) => { measurement.setVisible(id, visible); documentChanged(); } },
    { id: "annotations", label: "Annotations", items: annotations.records.map(record => ({ id: record.id, name: record.title, visible: record.visible })),
      onRename: (id, name) => { annotations.rename(id, name); documentChanged(); },
      onVisible: (id, visible) => { annotations.setVisible(id, visible); documentChanged(); } }
  ] : [];
  return <>
    <div ref={toolbar} className="selection-toolbar" role="group" aria-label="Selection tools">
      {tools.map(item => <button key={item.tool} title={item.label} aria-label={item.label} disabled={unavailable}
        aria-pressed={tool === item.tool} onClick={() => onToolChange(item.tool)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
          strokeDasharray={item.tool === "rectangle" ? "3 2" : undefined}><path d={item.path} /></svg>
      </button>)}
      <span role="status">{busy ? "Selecting…" : summary ? `${summary.selected.toLocaleString()} / ${summary.total.toLocaleString()} selected` : "Preparing selection…"}</span>
    </div>
    {selecting && <div className="selection-actions" role="group" aria-label="Selection actions">
      {tool === "brush" && <label>Brush size <input aria-label="Brush size" type="range" min="1" max="128" value={brushSize} disabled={busy} onChange={event => setBrushSize(Number(event.target.value))} /></label>}
      <button disabled={unavailable} aria-pressed={xray} title={xray ? "Select through the object" : "Select only visible surfaces"}
        onClick={() => setXray(!xray)}>X-ray {xray ? "on" : "off"}</button>
      <button disabled={unavailable || !summary?.selected} aria-pressed={summary?.isolated ?? false}
        onClick={() => { setSummary(history!.perform(() => handle!.selection.toggleIsolation())); documentChanged(); }}>{summary?.isolated ? "Show all" : "Isolate"}</button>
      <SelectionColorPicker disabled={unavailable || !summary?.selected}
        onApply={hex => { setSummary(history!.perform(() => handle!.selection.paint(encodeColor(hex)))); documentChanged(); }}
        onReset={() => { setSummary(history!.perform(() => handle!.selection.paint(0))); documentChanged(); }} />
      <button disabled={unavailable || !summary?.selected} onClick={() => { setSummary(history!.perform(() => handle!.selection.clear())); documentChanged(); }}>Clear</button>
    </div>}
    {error && <div className="selection-error" role="alert">{error}</div>}
    {groups.length > 0 && <ViewerTree groups={groups} />}
    {selecting && !unavailable && <SelectionGesture key={tool} tool={tool} brushSize={brushSize} onSelect={onSelect} />}
    {handle && annotations && <AnnotationControls handle={handle} annotations={annotations} active={tool === "annotate" && !disabled} interactive={tool === "navigate" || tool === "annotate"}
      hoverRegions={!disabled && tool !== "measure"}
      onChange={documentChanged} onRestore={state => { setSummary(history!.perform(() => handle.selection.restore(state))); documentChanged(); }} />}
    {handle && measurement && <MeasurementControls handle={handle} measurement={measurement} active={tool === "measure" && !disabled} onChange={documentChanged} />}
  </>;
}
