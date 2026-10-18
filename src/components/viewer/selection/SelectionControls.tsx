import { useEffect, useState } from "react";
import { RectangleSelection } from "./RectangleSelection";
import type { SelectionHandle } from "./SplatSelection";

export function SelectionControls({ handle, selecting, onModeChange, disabled }: {
  handle: SelectionHandle | null; selecting: boolean; onModeChange(selecting: boolean): void; disabled: boolean;
}) {
  const [summary, setSummary] = useState(handle?.selection.summary);
  useEffect(() => { setSummary(handle?.selection.summary); }, [handle]);
  const unavailable = disabled || !handle;

  return <>
    <div className="selection-toolbar" role="group" aria-label="Splat selection tools">
      <button disabled={unavailable} aria-pressed={!selecting} onClick={() => onModeChange(false)}>Navigate</button>
      <button disabled={unavailable} aria-pressed={selecting} onClick={() => onModeChange(true)}>Rectangle select</button>
      <button disabled={unavailable || !summary?.selected} onClick={() => setSummary(handle!.selection.clear())}>Clear</button>
      <button disabled={unavailable || !summary?.selected} aria-pressed={summary?.isolated ?? false}
        onClick={() => setSummary(handle!.selection.toggleIsolation())}>{summary?.isolated ? "Show all" : "Isolate"}</button>
      <span role="status">{summary ? `${summary.selected.toLocaleString()} / ${summary.total.toLocaleString()} selected` : "Preparing selection…"}</span>
    </div>
    {selecting && !unavailable && <RectangleSelection onSelect={(rectangle, operation) => {
      setSummary(handle.selection.select(rectangle, operation, handle.camera()));
    }} />}
  </>;
}
