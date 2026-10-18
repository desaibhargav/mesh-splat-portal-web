import { useEffect, useRef, useState } from "react";
import { SelectionGesture } from "./SelectionGesture";
import { captureDepth } from "./SelectionDepth";
import type { SelectionHandle, SelectionTool } from "./types";

const tools: { tool: SelectionTool; label: string; path: string }[] = [
  { tool: "navigate", label: "Navigate (Q)", path: "M5 3l14 10-7 1-3 7z" },
  { tool: "rectangle", label: "Rectangle select", path: "M4 4h16v16H4z" },
  { tool: "lasso", label: "Lasso select", path: "M9 18C1 17 1 5 12 4s14 12 3 14H9m0 0c-5 0-6 5-2 4 3-1 3-4 2-4z" },
  { tool: "brush", label: "Brush select", path: "M9 14L18 3l3 3-11 9m-1-1c-5-2-3 6-7 7 6 1 10-2 8-6z" }
];

export function SelectionControls({ handle, tool, onToolChange, disabled }: {
  handle: SelectionHandle | null; tool: SelectionTool; onToolChange(tool: SelectionTool): void; disabled: boolean;
}) {
  const [summary, setSummary] = useState(handle?.selection.summary);
  const [xray, setXray] = useState(false);
  const [brushSize, setBrushSize] = useState(32);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    setSummary(handle?.selection.summary); setError(null); setBusy(false);
    return () => { generation.current++; };
  }, [handle]);
  const unavailable = disabled || !handle || busy;
  const selecting = tool !== "navigate";
  return <>
    <div className="selection-toolbar" role="group" aria-label="Selection tools">
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
        onClick={() => setSummary(handle!.selection.toggleIsolation())}>{summary?.isolated ? "Show all" : "Isolate"}</button>
      <button disabled={unavailable || !summary?.selected} onClick={() => setSummary(handle!.selection.clear())}>Clear</button>
    </div>}
    {error && <div className="selection-error" role="alert">{error}</div>}
    {selecting && !unavailable && <SelectionGesture key={tool} tool={tool} brushSize={brushSize} onSelect={async (region, operation) => {
      const token = generation.current;
      setBusy(true); setError(null);
      try {
        const camera = handle.camera();
        const view = { projectionMatrix: camera.projectionMatrix.clone(), viewMatrix: camera.viewMatrix.clone() };
        const depth = xray ? undefined : await captureDepth(handle.app, camera);
        if (generation.current === token) setSummary(handle.selection.select(region, operation, view, depth));
      } catch (failure) {
        if (generation.current === token) setError(failure instanceof Error ? failure.message : String(failure));
      } finally { if (generation.current === token) setBusy(false); }
    }} />}
  </>;
}
