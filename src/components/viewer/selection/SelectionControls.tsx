import { SliderControl } from "../SliderControl";
import { SegmentWorkspaces } from "../segments/SegmentWorkspaces";
import { SegmentControls } from "../segments/SegmentControls";
import { packSelection } from "./selectionSnapshot";
import type { SelectionSnapshot } from "./types";
import { AnnotationControls } from "../annotations/AnnotationControls";
import { MeasurementControls } from "../measurement/MeasurementControls";
import { ViewerTree, type ViewerTreeGroup } from "../ViewerTree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectionGesture } from "./SelectionGesture";
import type { SelectionHandle, SelectionRegion, SelectionShape, SelectionTool } from "./types";
import type { SelectionOperation } from "./rectangle";
import { unpackSelection } from "./SelectionHistory";
import { SavedItems } from "../SavedItems";
import { encodeColor, saveSelectionArea, savedSelectionColors } from "./selectionColors";
import { SelectionColorPicker } from "./SelectionColorPicker";
import { ViewControls } from "../views/ViewControls";
import { SectionControls } from "../section/SectionControls";
import { CaptureControls } from "../capture/CaptureControls";
import { tools } from "../toolDefinitions";

const selectionShapes: { shape: SelectionShape; label: string }[] = [
  { shape: "rectangle", label: "Box" },
  { shape: "lasso", label: "Lasso" },
  { shape: "brush", label: "Brush" }
];

type OpenRequest = { tool: SelectionTool; id: number };

export function SelectionControls(props: {
  handle: SelectionHandle | null; workspaces: SegmentWorkspaces | null; tool: SelectionTool;
  onToolChange(tool: SelectionTool): void; disabled: boolean; captureName: string;
}) {
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  useEffect(() => { if (openRequest && openRequest.tool !== props.tool) setOpenRequest(null); }, [props.tool, openRequest]);
  const workspaces = props.workspaces;
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!workspaces) return;
    const change = () => refresh(value => value + 1);
    const open = () => props.onToolChange("segment");
    workspaces.on("change", change); workspaces.on("open", open);
    return () => { workspaces.off("change", change); workspaces.off("open", open); };
  }, [workspaces, props.onToolChange]);
  return <WorkspaceTools key={workspaces?.current.id ?? "loading"} {...props} workspaces={workspaces} openRequest={openRequest} setOpenRequest={setOpenRequest} />;
}

function WorkspaceTools({ handle, tool, onToolChange, disabled, captureName, workspaces, openRequest, setOpenRequest }: {
  handle: SelectionHandle | null; tool: SelectionTool; onToolChange(tool: SelectionTool): void; disabled: boolean; workspaces: SegmentWorkspaces | null;
  captureName: string;
  openRequest: OpenRequest | null; setOpenRequest(request: OpenRequest | null): void;
}) {
  const [drawingSegment, setDrawingSegment] = useState(false);
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const [segmentSeed, setSegmentSeed] = useState<SelectionSnapshot | null>(null);
  const document = workspaces?.current;
  const [summary, setSummary] = useState(handle?.selection.summary);
  const [selectionName, setSelectionName] = useState("");
  const [editingSelection, setEditingSelection] = useState<number | null>(null);
  const [xray, setXray] = useState(false);
  const views = document?.views;
  const sections = document?.sections;
  const [selectionShape, setSelectionShape] = useState<SelectionShape>("rectangle");
  const [brushSize, setBrushSize] = useState(10);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Selecting…");
  const [error, setError] = useState<string | null>(null);
  const [, refreshDocument] = useState(0);
  const generation = useRef(0);
  const toolbar = useRef<HTMLDivElement>(null);
  // XR operates on the same controller without going through React setters.
  // Keep desktop counts/actions in sync when a shared document edit arrives.
  useEffect(() => {
    if (!workspaces || !handle) return;
    const changed = () => setSummary(handle.selection.summary);
    workspaces.on("change", changed);
    return () => { workspaces.off("change", changed); };
  }, [workspaces, handle]);
  const history = workspaces?.history;
  const measurement = document?.measurement;
  const annotations = document?.annotations;
  const documentChanged = useCallback(() => refreshDocument(value => value + 1), []);
  useEffect(() => { if (tool !== "segment") { setSegmentSeed(null); setDrawingSegment(false); } }, [tool]);
  useEffect(() => { setOptionsCollapsed(false); }, [tool]);
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
    if (!views || !sections) return;
    views.on("change", documentChanged); sections.on("change", documentChanged);
    return () => { views.off("change", documentChanged); sections.off("change", documentChanged); };
  }, [views, sections, documentChanged]);
  const unavailable = disabled || !handle || busy || document?.visible === false;
  const selecting = tool === "select" || (tool === "segment" && drawingSegment);
  useEffect(() => {
    if (tool !== "navigate" || !handle || !history) return;
    generation.current++; // A pending GPU selection must not recreate a discarded draft.
    const selection = handle.selection;
    const areas = selection.areas.filter(area => area.saved);
    const colors = savedSelectionColors(selection.colors, selection.areas);
    if (selection.summary.selected || areas.length !== selection.areas.length) {
      setSummary(history.perform(() => selection.restore({
        masks: selection.state.masks.map(mask => new Uint8Array(mask.length)), isolated: false
      }, colors, areas)));
      documentChanged();
    }
    setBusy(false); setEditingSelection(null); setSelectionName("");
  }, [tool, handle, history, documentChanged]);
  useEffect(() => {
    const frame = toolbar.current?.closest(".viewer-frame");
    if (!frame || !handle || !history || (tool === "measure" || tool === "annotate" || tool === "views")) return;
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
        if (bounds) handle.viewports.focus(bounds);
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
      if (generation.current === token && workspaces?.current === document) {
        setSummary(history.perform(() => handle.selection.select(region, operation, view, hits)));
        documentChanged();
      }
    } catch (failure) {
      if (generation.current === token) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (generation.current === token) setBusy(false); }
  }, [handle, history, xray, documentChanged, workspaces, document]);
  const paint = useCallback((color: number) => {
    if (!handle || !history || busy) return;
    const token = generation.current;
    setBusy(true); setBusyLabel("Applying color…"); setError(null);
    requestAnimationFrame(() => {
      if (generation.current !== token || workspaces?.current !== document) return;
      try {
        setSummary(history.perform(() => handle.selection.paint(color, document?.color)));
        documentChanged();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (generation.current === token) setBusy(false);
      }
    });
  }, [handle, history, busy, documentChanged, workspaces, document]);
  const applyColor = useCallback((hex: string) => {
    try { paint(encodeColor(hex)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, [paint]);
  function drawSegment(value: boolean) {
    if (!value && drawingSegment && handle && history) {
      generation.current++; setBusy(false);
      setSummary(history.perform(() => handle.selection.clear()));
    } else setSummary(handle?.selection.summary);
    setDrawingSegment(value);
  }
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
    setSummary(history.perform(() => {
      const areas = saveSelectionArea(selection.areas, selection.state, selectionName, editingSelection);
      const saved = areas.at(-1);
      return selection.restore(saved ? unpackSelection(saved.snapshot) : selection.state, selection.colors, areas);
    }));
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
  function frameBounds(bounds: ReturnType<SelectionHandle["selection"]["bounds"]>) {
    if (bounds) handle!.viewports.focus(bounds);
  }
  function openItem(tool: SelectionTool, id: number) {
    if (!handle || !workspaces || busy) return;
    if (tool === "segment") {
      workspaces.setVisible(id, true); workspaces.open(id);
    }
    onToolChange(tool);
    setOpenRequest({ tool, id });
  }
  useEffect(() => {
    if (!openRequest || openRequest.tool !== tool || !handle) return;
    if (tool === "select") { activateSelection(openRequest.id); frameBounds(handle.selection.bounds()); }
    else if (tool === "segment") frameBounds(handle.selection.bounds(null));
  }, [tool, openRequest, handle]);
  const groups: ViewerTreeGroup[] = handle && history && measurement && annotations && views && sections ? [
    ...(workspaces ? [{ id: "segments", label: "Segments", items: workspaces.records,
      onOpen: (id: number) => openItem("segment", id),
      onRename: (id: number, name: string) => workspaces.rename(id, name),
      onVisible: (id: number, visible: boolean) => workspaces.setVisible(id, visible) }] : []),
    { id: "views", label: "Views", items: views.records,
      onOpen: (id: number) => openItem("views", id),
      onRename: (id, name) => views.rename(id, name) },
    { id: "sections", label: "Sections", items: sections.records.map(item => ({ ...item, visible: sections.activeId === item.id })),
      onOpen: (id: number) => openItem("section", id),
      onRename: (id, name) => sections.rename(id, name),
      onVisible: (id, visible) => sections.setVisible(id, visible) },
    { id: "selections", label: "Selections", items: savedSelections,
      onOpen: (id: number) => openItem("select", id),
      onRename: (id, name) => { setSummary(history.perform(() => handle.selection.renameArea(id, name))); documentChanged(); },
      onVisible: (id, visible) => { setSummary(history.perform(() => handle.selection.setAreaVisible(id, visible))); documentChanged(); } },
    { id: "measurements", label: "Measurements", items: measurement.records.filter(record => record.saved),
      onOpen: (id: number) => openItem("measure", id),
      onRename: (id, name) => { measurement.rename(id, name); documentChanged(); },
      onVisible: (id, visible) => { measurement.setVisible(id, visible); documentChanged(); } },
    { id: "annotations", label: "Annotations", items: annotations.records.map(record => ({ id: record.id, name: record.title, visible: record.visible })),
      onOpen: (id: number) => openItem("annotate", id),
      onRename: (id, name) => { annotations.rename(id, name); documentChanged(); },
      onVisible: (id, visible) => { annotations.setVisible(id, visible); documentChanged(); } }
  ] : [];
  const shapeOptions = <>
        <fieldset className="selection-shapes" disabled={unavailable}>
          <legend>Selection type</legend>
          {selectionShapes.map(({ shape, label }) => <button key={shape} type="button"
            aria-pressed={selectionShape === shape} onClick={() => setSelectionShape(shape)}>{label}</button>)}
        </fieldset>
        {selectionShape === "brush" && <SliderControl label="Brush size" min={1} max={50} value={brushSize} unit="%" disabled={busy} onChange={setBrushSize} />}
        <button disabled={unavailable} aria-pressed={xray} title={xray ? "Select through the object" : "Select only visible surfaces"}
          onClick={() => setXray(!xray)}>X-ray {xray ? "on" : "off"}</button>
  </>;
  return <>
    <div ref={toolbar} className="selection-toolbar" role="group" aria-label="Selection tools">
      {tools.map(item => <button key={item.tool} title={item.label} aria-label={item.label} disabled={unavailable}
        aria-pressed={tool === item.tool} onClick={() => onToolChange(item.tool)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
          strokeDasharray={item.tool === "select" ? "3 2" : undefined}><path d={item.path} /></svg>
      </button>)}
      <span role="status">{busy ? busyLabel : summary ? `${summary.selected.toLocaleString()} / ${summary.total.toLocaleString()} selected` : "Preparing selection…"}</span>
    </div>
    {workspaces && document && document.id !== 0 && <div className="workspace-banner" role="group" aria-label="Active workspace">
      <span>Segment: {document.name}{!document.visible && " (hidden)"}</span>
      <button className="tool-action-reset" onClick={() => { workspaces.open(0); onToolChange("navigate"); }}>Return to asset</button>
    </div>}
    {tool !== "navigate" && <button type="button" className="tool-options-toggle" aria-label={optionsCollapsed ? "Expand tool options" : "Collapse tool options"}
      aria-expanded={!optionsCollapsed} title={optionsCollapsed ? "Expand options" : "Collapse options"}
      onClick={() => setOptionsCollapsed(value => !value)}>{optionsCollapsed ? "‹" : "›"}</button>}
    {tool === "select" && <div className="annotation-panels selection-panels">
      <SavedItems label="Selections" items={savedSelections} selectedId={editingSelection} disabled={unavailable}
        className="selection-list" onOpen={activateSelection} onRemove={removeSelection} />
      <div className="selection-actions selection-options" role="group" aria-label="Selection actions">
        {shapeOptions}
        <button disabled={unavailable || !summary?.selected} aria-pressed={summary?.isolated ?? false}
          onClick={() => { setSummary(history!.perform(() => handle!.selection.toggleIsolation())); documentChanged(); }}>{summary?.isolated ? "Show all" : "Isolate"}</button>
        <button disabled={unavailable || !summary?.selected} onClick={() => {
          setSegmentSeed(packSelection(handle!.selection.state)); onToolChange("segment");
        }}>Create segment</button>
        <label>Selection name<input aria-label="Selection name" value={selectionName} disabled={unavailable}
          onChange={event => setSelectionName(event.target.value)} /></label>
        <button disabled={unavailable || !summary?.selected || !selectionName.trim()} className="tool-action-save" onClick={saveSelection}>
          {editingSavedSelection ? "Update selection" : "Save selection"}
        </button>
        {editingSavedSelection && <button disabled={unavailable} onClick={() => {
          setEditingSelection(null); setSelectionName(""); setSummary(history!.perform(() => handle!.selection.clear())); documentChanged();
        }}>New selection</button>}
        <SelectionColorPicker disabled={unavailable || !summary?.selected}
          onApply={applyColor}
          onReset={() => paint(0)} />
        <button className="tool-action-reset" disabled={unavailable || !summary?.selected} onClick={() => { setSummary(history!.perform(() => handle!.selection.clear())); documentChanged(); }}>Clear Selection</button>
      </div>
    </div>}
    {handle && workspaces && <SegmentControls handle={handle} workspaces={workspaces} active={tool === "segment" && !disabled && document?.visible !== false}
      seed={segmentSeed} drawing={drawingSegment} onDraw={drawSegment} disabled={busy || disabled}>{shapeOptions}</SegmentControls>}
    {error && <div className="selection-error" role="alert">{error}</div>}
    {groups.length > 0 && <ViewerTree groups={groups} />}
    {selecting && !unavailable && <SelectionGesture handle={handle!} key={selectionShape} tool={selectionShape} brushSize={brushSize} onSelect={onSelect} />}
    {document?.visible && handle && annotations && <AnnotationControls openRequest={openRequest?.tool === "annotate" ? openRequest : null} handle={handle} annotations={annotations} active={tool === "annotate" && !disabled} interactive={tool === "navigate" || tool === "annotate"}
      hoverRegions={!disabled && (tool === "navigate" || tool === "annotate" || tool === "select")}
      onChange={documentChanged} />}
    {document?.visible && handle && measurement && <MeasurementControls openRequest={openRequest?.tool === "measure" ? openRequest : null} handle={handle} measurement={measurement} active={tool === "measure" && !disabled} onChange={documentChanged} />}
    {document?.visible && handle && views && <ViewControls openRequest={openRequest?.tool === "views" ? openRequest : null} handle={handle} active={tool === "views" && !disabled} views={views} />}
    {document?.visible && handle && views && sections && <SectionControls openRequest={openRequest?.tool === "section" ? openRequest : null} handle={handle} active={tool === "section" && !disabled} views={views.records} sections={sections} session={document.sectionSession} />}
    {document?.visible && handle && annotations && <CaptureControls handle={handle} annotations={annotations.records}
      active={tool === "capture" && !disabled} initialName={captureName} />}
  </>;
}
