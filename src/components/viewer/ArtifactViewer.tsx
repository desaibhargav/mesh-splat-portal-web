import { ViewportLayout, ViewportToggle } from "./viewports/ViewportLayout";
import { Application } from "@playcanvas/react";
import { useEffect, useRef, useState } from "react";
import type { Artifact } from "../../api/artifacts";
import { MeshViewer } from "./MeshViewer";
import { SplatViewer } from "./SplatViewer";
import { SelectionControls } from "./selection/SelectionControls";
import type { SelectionHandle, SelectionTool } from "./selection/types";
import { TypingRenderPolicy } from "./TypingRenderPolicy";

export type ViewerStatus = { loading: boolean; progress: number; error: string | null };

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const frame = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<ViewerStatus>({ loading: true, progress: 0, error: null });
  const [fullscreen, setFullscreen] = useState(false);
  const [selection, setSelection] = useState<SelectionHandle | null>(null);
  const [tool, setTool] = useState<SelectionTool>("navigate");
  const selecting = tool !== "navigate";
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
    <section ref={frame} className="viewer-frame has-selection-tools" tabIndex={0} aria-label={`${artifact.title} 3D viewer`}
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
        {selection && <ViewportToggle handle={selection} />}
        <button onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </div>
      <SelectionControls handle={selection} tool={tool} onToolChange={changeTool} disabled={status.loading || Boolean(status.error)} captureName={artifact.title} />
      <div className="viewer-canvas">
        <Application graphicsDeviceOptions={{ antialias: artifact.type === "mesh" }}>
          <TypingRenderPolicy scope={frame} />
          {artifact.type === "mesh" ? <MeshViewer url={artifact.contentUrl} onStatus={setStatus} onSelectionReady={setSelection} /> :
            <SplatViewer url={artifact.contentUrl} onStatus={setStatus} onSelectionReady={setSelection} />}
        </Application>
      </div>
      {selection && <ViewportLayout handle={selection} />}
      {status.loading && <div className="viewer-loading" role="status"><span>Loading 3D asset</span><progress value={status.progress} max={1} /></div>}
      {status.error && <div className="viewer-error" role="alert">{status.error}</div>}
      <p className="viewer-help">{tool === "capture" ? "Name and download the current view · Q: exit" : tool === "section" ? "Slide or tilt the cutting plane · Alt/Option or right-drag: orbit · Middle-drag: pan · Scroll: zoom · Q: exit" : tool === "views" ? "Rotate asset against world grid · Drag outside handles: orbit · Middle-drag: pan · Scroll: zoom · Q: exit" : tool === "annotate" ? "Choose optional area binding, then click a surface to place the marker · Alt/Option or right-drag: orbit · Middle-drag: pan · Scroll: zoom · Q: exit" : tool === "measure" ? "Click two points · Shift-click: new measurement · Alt/Option or right-drag: orbit · Middle-drag: pan · Scroll: zoom · F: focus · Q: exit" : selecting ? "Drag to select · Shift: add · Ctrl/Cmd: remove · Shift + Ctrl/Cmd: intersect · Alt/Option or right-drag: orbit · Middle-drag: pan · Scroll: zoom · Q: exit" :
        "Drag to orbit · Shift-drag or middle-drag to pan · Scroll to zoom · F: focus"}</p>
    </section>
  );
}
