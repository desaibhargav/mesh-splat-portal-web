import { useEffect, useState } from "react";
import type { SelectionHandle } from "../selection/types";
import { downloadCapture } from "./captureImage";
import type { AnnotationRecord } from "../annotations/Annotations";

export function CaptureControls({ handle, annotations, active, initialName }: {
  handle: SelectionHandle; annotations: readonly AnnotationRecord[]; active: boolean; initialName: string;
}) {
  const [name, setName] = useState(`${initialName} view`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setName(`${initialName} view`); }, [initialName]);
  if (!active) return null;
  async function download(withAnnotations = false) {
    setBusy(true); setError(null);
    try { await downloadCapture(handle, name, withAnnotations ? annotations : undefined); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <div className="annotation-panels capture-panels">
    <div className="selection-actions capture-actions" role="group" aria-label="Capture view">
      <label>Capture name<input aria-label="Capture name" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <button className="tool-action-save" disabled={busy || !name.trim()} onClick={() => void download()}>{busy ? "Preparing PNG…" : "Download"}</button>
      <button className="tool-action-save" disabled={busy || !name.trim() || !annotations.some(record => record.visible)}
        onClick={() => void download(true)}>Download with annotations</button>
      {error && <span role="alert">{error}</span>}
    </div>
  </div>;
}
