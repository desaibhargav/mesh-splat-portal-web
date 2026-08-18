import { Application } from "@playcanvas/react";
import { useEffect, useRef, useState } from "react";
import type { Artifact } from "../../api/artifacts";
import { MeshViewer } from "./MeshViewer";
import { SplatViewer } from "./SplatViewer";

export type ViewerStatus = { loading: boolean; progress: number; error: string | null };

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const frame = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<ViewerStatus>({ loading: true, progress: 0, error: null });
  const [fullscreen, setFullscreen] = useState(false);

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
    <section ref={frame} className="viewer-frame" aria-label={`${artifact.title} 3D viewer`}>
      <div className="viewer-toolbar">
        <span>{artifact.type === "mesh" ? "Mesh" : "Gaussian splat"}</span>
        <button onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </div>
      <div className="viewer-canvas">
        <Application graphicsDeviceOptions={{ antialias: artifact.type === "mesh" }}>
          {artifact.type === "mesh" ? <MeshViewer url={artifact.contentUrl} onStatus={setStatus} /> : <SplatViewer url={artifact.contentUrl} onStatus={setStatus} />}
        </Application>
      </div>
      {status.loading && <div className="viewer-loading" role="status"><span>Loading 3D asset</span><progress value={status.progress} max={1} /></div>}
      {status.error && <div className="viewer-error" role="alert">{status.error}</div>}
      <p className="viewer-help">Drag to orbit · Shift-drag or middle-drag to pan · Scroll to zoom</p>
    </section>
  );
}
