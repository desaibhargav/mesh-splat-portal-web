import { Application } from "@playcanvas/react";
import { useEffect, useRef, useState } from "react";
import type { Artifact } from "../../api/artifacts";
import { MeshViewer } from "./MeshViewer";
import { SplatViewer } from "./SplatViewer";
import { SelectionControls } from "./selection/SelectionControls";
import type { SelectionHandle } from "./selection/SplatSelection";

export type ViewerStatus = { loading: boolean; progress: number; error: string | null };

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const frame = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<ViewerStatus>({ loading: true, progress: 0, error: null });
  const [fullscreen, setFullscreen] = useState(false);
  const [selection, setSelection] = useState<SelectionHandle | null>(null);
  const [selecting, setSelecting] = useState(false);
  const isSplat = artifact.type === "splat";

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
    <section ref={frame} className={`viewer-frame${isSplat ? " has-selection-tools" : ""}`} aria-label={`${artifact.title} 3D viewer`}
      onKeyDown={event => { if (event.key === "Escape") setSelecting(false); }}>
      <div className="viewer-toolbar">
        <span>{artifact.type === "mesh" ? "Mesh" : "Gaussian splat"}</span>
        <button onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </div>
      {isSplat && <SelectionControls handle={selection} selecting={selecting} onModeChange={setSelecting} disabled={status.loading || Boolean(status.error)} />}
      <div className="viewer-canvas">
        <Application graphicsDeviceOptions={{ antialias: artifact.type === "mesh" }}>
          {artifact.type === "mesh" ? <MeshViewer url={artifact.contentUrl} onStatus={setStatus} /> :
            <SplatViewer url={artifact.contentUrl} onStatus={setStatus} selecting={selecting} onSelectionReady={setSelection} />}
        </Application>
      </div>
      {status.loading && <div className="viewer-loading" role="status"><span>Loading 3D asset</span><progress value={status.progress} max={1} /></div>}
      {status.error && <div className="viewer-error" role="alert">{status.error}</div>}
      <p className="viewer-help">{selecting ? "Drag a rectangle through the scene · Shift: add · Ctrl/Cmd: remove · Shift + Ctrl/Cmd: intersect" :
        "Drag to orbit · Shift-drag or middle-drag to pan · Scroll to zoom"}</p>
    </section>
  );
}
