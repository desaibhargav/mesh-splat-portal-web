import { AnnotationControls } from "../annotations/AnnotationControls";
import { Annotations } from "../annotations/Annotations";
import { MeasurementControls } from "../measurement/MeasurementControls";
import { Measurement } from "../measurement/Measurement";
import { ViewerTree, type ViewerTreeGroup } from "../ViewerTree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectionGesture } from "./SelectionGesture";
import type { SelectionHandle, SelectionRegion, SelectionShape, SelectionTool } from "./types";
import type { SelectionOperation } from "./rectangle";
import { SelectionHistory, unpackSelection } from "./SelectionHistory";
import { SavedItems } from "../SavedItems";
import { encodeColor, saveSelectionArea } from "./selectionColors";
import { SelectionColorPicker } from "./SelectionColorPicker";
import { focusSelection } from "./focusSelection";
import { ViewControls } from "../views/ViewControls";
import type { NamedView } from "../views/viewFrame";
import { SavedPresets } from "../presets/SavedPresets";
import type { NamedSection } from "../section/SectionControls";
import { SectionControls } from "../section/SectionControls";

const tools: { tool: SelectionTool; label: string; path: string }[] = [
  { tool: "navigate", label: "Navigate (Q)", path: "M5 3l14 10-7 1-3 7z" },
  { tool: "select", label: "Select", path: "M4 4h16v16H4z" },
  { tool: "measure", label: "Measure distance", path: "M3 16L16 3l5 5L8 21zM7 12l3 3m0-6 3 3m0-6 3 3" },
  { tool: "annotate", label: "Annotate", path: "M4 4h16v12H9l-5 5zM8 8h8m-8 4h5" },
  { tool: "views", label: "Views", path: "M12 12V3m0 9 8 5m-8-5-8 5M9 6l3-3 3 3m2 5 3 6-6-1M4 11v6l6-1" },
  { tool: "section", label: "Cross section", path: "M3 8l9-5 9 5-9 5zM3 8v9l9 4 9-4V8M12 13v8M2 14l20-5" }
];
const selectionShapes: { shape: SelectionShape; label: string }[] = [
  { shape: "rectangle", label: "Box" },
  { shape: "lasso", label: "Lasso" },
  { shape: "brush", label: "Brush" }
];

export function SelectionControls({ handle, tool, onToolChange, disabled }: {
  handle: SelectionHandle | null; tool: SelectionTool; onToolChange(tool: SelectionTool): void; disabled: boolean;
}) {
  const [summary, setSummary] = useState(handle?.selection.summary);
  const [selectionName, setSelectionName] = useState("");
  const [editingSelection, setEditingSelection] = useState<number | null>(null);
  const [xray, setXray] = useState(false);
  const views = useMemo(() => new SavedPresets<NamedView>(), [handle]);
  const sections = useMemo(() => new SavedPresets<NamedSection>(), [handle]);
  const [selectionShape, setSelectionShape] = useState<SelectionShape>("rectangle");
  const [brushSize, setBrushSize] = useState(32);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Selecting…");
  const [error, setError] = useState<string | null>(null);
  const [, refreshDocument] = useState(0);
  const generation = useRef(0);
  const toolbar = useRef<HTMLDivElement>(null);
  const history = useMemo(() => handle ? new SelectionHistory(handle.selection) : null, [handle]);
  const measurement = useMemo(() => handle ? new Measurement() : null, [handle]);
  const annotations = useMemo(() => handle ? new Annotations() : null, [handle]);
  const documentChanged = useCallback(() => refreshDocument(value => value + 1), []);
  useEffect(() => {
    setSummary(handle?.selection.summary); setError(null); setBusy(false); setBusyLabel("Selecting…");
    return () => { generation.current++; };
  }, [handle]);
  useEffect(() => {
    if (!handle) return;
    const changed = () => handle.selection.updateSection();
    handle.space.on("change", changed);
    return () => { handle.space.off("change", changed); };
  }, [handle]);
  useEffect(() => {
    views.on("change", documentChanged); sections.on("change", documentChanged);
    return () => { views.off("change", documentChanged); sections.off("change", documentChanged); };
  }, [views, sections, documentChanged]);
  const unavailable = disabled || !handle || busy;
  const selecting = tool === "select";
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
        const bounds = handle.selection.bounds(selecting ? undefined : null);
        if (bounds) focusSelection(bounds, handle.camera());
      }
    };
    frame.addEventListener("keydown", onKeyDown);
    return () => frame.removeEventListener("keydown", onKeyDown);
  }, [handle, history, unavailable, tool]);
  const onSelect = useCallback(async (region: SelectionRegion, operation: SelectionOperation) => {
    if (!handle || !history) return;
    const token = generation.current;
    setBusy(true); setBusyLabel("Selecting…"); setError(null);
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
  const paint = useCallback((color: number) => {
    if (!handle || !history || busy) return;
    const token = generation.current;
    setBusy(true); setBusyLabel("Applying color…"); setError(null);
    requestAnimationFrame(() => {
      if (generation.current !== token) return;
      try {
        setSummary(history.perform(() => handle.selection.paint(color)));
        documentChanged();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (generation.current === token) setBusy(false);
      }
    });
  }, [handle, history, busy, documentChanged]);
  const applyColor = useCallback((hex: string) => {
    try { paint(encodeColor(hex)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, [paint]);
  function activateSelection(id: number) {
    if (!handle || !history || busy) return;
    const area = handle.selection.areas.find(item => item.id === id);
    if (!area) return;
    setSummary(history.perform(() => {
      handle.selection.setAreaVisible(id, true);
      return handle.selection.restore(unpackSelection(area.snapshot));
    }));
    setEditingSelection(id); setSelectionName(area.name);
    documentChanged();
  }
  function saveSelection() {
    if (!handle || !history || unavailable) return;
    const selection = handle.selection;
    setSummary(history.perform(() => selection.restore(selection.state, selection.colors,
      saveSelectionArea(selection.areas, selection.state, selectionName, editingSelection))));
    setEditingSelection(null); setSelectionName(""); documentChanged();
  }
  function removeSelection(id: number) {
    if (!handle || !history || unavailable) return;
    const selection = handle.selection;
    const state = editingSelection === id
      ? { masks: selection.state.masks.map(mask => new Uint8Array(mask.length)), isolated: false } : selection.state;
    setSummary(history.perform(() => selection.restore(state, selection.colors, selection.areas.filter(area => area.id !== id))));
    if (editingSelection === id) { setEditingSelection(null); setSelectionName(""); }
    documentChanged();
  }
  const savedSelections = handle?.selection.areas.filter(area => area.saved) ?? [];
  const editingSavedSelection = savedSelections.some(area => area.id === editingSelection);
  const savedSelectionName = savedSelections.find(area => area.id === editingSelection)?.name;
  useEffect(() => { if (savedSelectionName !== undefined) setSelectionName(savedSelectionName); }, [savedSelectionName]);
  const groups: ViewerTreeGroup[] = handle && history && measurement && annotations ? [
    { id: "views", label: "Views", items: views.records,
      onRename: (id, name) => views.rename(id, name) },
    { id: "sections", label: "Sections", items: sections.records.map(item => ({ ...item, visible: sections.activeId === item.id })),
      onRename: (id, name) => sections.rename(id, name),
      onVisible: (id, visible) => sections.setVisible(id, visible) },
    { id: "selections", label: "Selections", items: savedSelections,
      onRename: (id, name) => { setSummary(history.perform(() => handle.selection.renameArea(id, name))); documentChanged(); },
      onVisible: (id, visible) => { setSummary(history.perform(() => handle.selection.setAreaVisible(id, visible))); documentChanged(); } },
    { id: "measurements", label: "Measurements", items: measurement.records.filter(record => record.saved),
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
          strokeDasharray={item.tool === "select" ? "3 2" : undefined}><path d={item.path} /></svg>
      </button>)}
      <span role="status">{busy ? busyLabel : summary ? `${summary.selected.toLocaleString()} / ${summary.total.toLocaleString()} selected` : "Preparing selection…"}</span>
    </div>
    {selecting && <div className="annotation-panels selection-panels">
      <SavedItems label="Selections" items={savedSelections} selectedId={editingSelection} disabled={unavailable}
        className="selection-list" onOpen={activateSelection} onRemove={removeSelection} />
      <div className="selection-actions selection-options" role="group" aria-label="Selection actions">
        <fieldset className="selection-shapes" disabled={unavailable}>
          <legend>Selection type</legend>
          {selectionShapes.map(({ shape, label }) => <button key={shape} type="button"
            aria-pressed={selectionShape === shape} onClick={() => setSelectionShape(shape)}>{label}</button>)}
        </fieldset>
        {selectionShape === "brush" && <label>Brush size <input aria-label="Brush size" type="range" min="1" max="128" value={brushSize} disabled={busy} onChange={event => setBrushSize(Number(event.target.value))} /></label>}
        <button disabled={unavailable} aria-pressed={xray} title={xray ? "Select through the object" : "Select only visible surfaces"}
          onClick={() => setXray(!xray)}>X-ray {xray ? "on" : "off"}</button>
        <button disabled={unavailable || !summary?.selected} aria-pressed={summary?.isolated ?? false}
          onClick={() => { setSummary(history!.perform(() => handle!.selection.toggleIsolation())); documentChanged(); }}>{summary?.isolated ? "Show all" : "Isolate"}</button>
        <label>Selection name<input aria-label="Selection name" value={selectionName} disabled={unavailable}
          onChange={event => setSelectionName(event.target.value)} /></label>
        <button disabled={unavailable || !summary?.selected || !selectionName.trim()} onClick={saveSelection}>
          {editingSavedSelection ? "Update selection" : "Save selection"}
        </button>
        {editingSavedSelection && <button disabled={unavailable} onClick={() => {
          setEditingSelection(null); setSelectionName(""); setSummary(history!.perform(() => handle!.selection.clear())); documentChanged();
        }}>New selection</button>}
        <SelectionColorPicker disabled={unavailable || !summary?.selected}
          onApply={applyColor}
          onReset={() => paint(0)} />
        <button disabled={unavailable || !summary?.selected} onClick={() => { setSummary(history!.perform(() => handle!.selection.clear())); documentChanged(); }}>Clear</button>
      </div>
    </div>}
    {error && <div className="selection-error" role="alert">{error}</div>}
    {groups.length > 0 && <ViewerTree groups={groups} />}
    {selecting && !unavailable && <SelectionGesture handle={handle!} key={selectionShape} tool={selectionShape} brushSize={brushSize} onSelect={onSelect} />}
    {handle && annotations && <AnnotationControls handle={handle} annotations={annotations} active={tool === "annotate" && !disabled} interactive={tool === "navigate" || tool === "annotate"}
      hoverRegions={!disabled && (tool === "navigate" || tool === "annotate" || tool === "select")}
      onChange={documentChanged} />}
    {handle && measurement && <MeasurementControls handle={handle} measurement={measurement} active={tool === "measure" && !disabled} onChange={documentChanged} />}
    {handle && <ViewControls handle={handle} active={tool === "views" && !disabled} views={views} />}
    {handle && <SectionControls handle={handle} active={tool === "section" && !disabled} views={views.records} sections={sections} />}
  </>;
}
