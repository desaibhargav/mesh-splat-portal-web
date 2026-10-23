import { ViewportLayout } from "./viewports/ViewportLayout";
import { Application } from "@playcanvas/react";
import { useEffect, useRef, useState } from "react";
import type { Artifact } from "../../api/artifacts";
import { MeshViewer } from "./MeshViewer";
import { SplatViewer } from "./SplatViewer";
import { SelectionControls } from "./selection/SelectionControls";
import type { SelectionHandle, SelectionTool } from "./selection/types";
import { TypingRenderPolicy } from "./TypingRenderPolicy";
import { ImmersiveControls } from "./xr/ImmersiveControls";

export type ViewerStatus = { loading: boolean; progress: number; error: string | null };

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const frame = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<ViewerStatus>({ loading: true, progress: 0, error: null });
  const [fullscreen, setFullscreen] = useState(false);
  const [selection, setSelection] = useState<SelectionHandle | null>(null);
  const [tool, setTool] = useState<SelectionTool>("navigate");
  const [immersive, setImmersive] = useState(false);
  function changeTool(next: SelectionTool) { setTool(next); }

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await frame.current?.requestFullscreen();
  }

  return (
    <section ref={frame} className="viewer-frame has-selection-tools" data-immersive={immersive} tabIndex={0} aria-label={`${artifact.title} 3D viewer`}
      onClickCapture={event => {
        if ((event.target as HTMLElement).closest(".selection-toolbar button, .selection-actions button, .viewer-tree button, .viewer-toolbar button, .viewport-label")) frame.current?.focus({ preventScroll: true });
      }}
      onPointerDownCapture={event => {
        if (!(event.target as HTMLElement).closest("button, input, select, textarea")) frame.current?.focus({ preventScroll: true });
      }}
      onKeyDown={event => {
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest("input:not([type=range]), textarea, select, [contenteditable]:not([contenteditable=false])")) return;
        if (event.key.toLowerCase() === "q" || event.key === "Escape") {
          event.preventDefault(); frame.current?.focus({ preventScroll: true }); changeTool("navigate");
        }
      }}>
      <div className="viewer-toolbar">
        <span>{artifact.type === "mesh" ? "Mesh" : "Gaussian splat"}</span>
        <button onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </div>
      <SelectionControls handle={selection} tool={tool} onToolChange={changeTool} disabled={status.loading || Boolean(status.error)} captureName={artifact.title} />
      <div className="viewer-canvas">
        <Application graphicsDeviceOptions={{ antialias: artifact.type === "mesh", xrCompatible: true }}>
          <TypingRenderPolicy scope={frame} />
          {artifact.type === "mesh" ? <MeshViewer url={artifact.contentUrl} onStatus={setStatus} onSelectionReady={setSelection} /> :
            <SplatViewer url={artifact.contentUrl} onStatus={setStatus} onSelectionReady={setSelection} />}
        </Application>
      </div>
      {selection && <ViewportLayout handle={selection} />}
      {status.loading && <div className="viewer-loading" role="status"><span>Loading 3D asset</span><progress value={status.progress} max={1} /></div>}
      {status.error && <div className="viewer-error" role="alert">{status.error}</div>}
      <div className="viewer-footer">{selection && <ImmersiveControls handle={selection} onActive={setImmersive} />}</div>
    </section>
  );
}
