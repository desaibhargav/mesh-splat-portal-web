import { useEffect, useState } from "react";
import type { SelectionHandle } from "../selection/types";
import { downloadCapture } from "./captureImage";

export function CaptureControls({ handle, active, initialName }: {
  handle: SelectionHandle; active: boolean; initialName: string;
}) {
  const [name, setName] = useState(`${initialName} view`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setName(`${initialName} view`); }, [initialName]);
  if (!active) return null;
  async function download() {
    setBusy(true); setError(null);
    try { await downloadCapture(handle.app, name); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <div className="annotation-panels capture-panels">
    <div className="selection-actions capture-actions" role="group" aria-label="Capture view">
      <label>Capture name<input aria-label="Capture name" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <button className="tool-action-save" disabled={busy || !name.trim()} onClick={() => void download()}>{busy ? "Preparing PNG…" : "Download capture"}</button>
      {error && <span role="alert">{error}</span>}
    </div>
  </div>;
}
