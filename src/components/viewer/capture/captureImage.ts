import type { AppBase } from "playcanvas";

export function captureFilename(name: string): string {
  const stem = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 120);
  return `${stem || "capture"}.png`;
}

// Capture after PlayCanvas completes a frame so this also works once the viewer
// moves to render-on-demand. Every visible viewport renders into this one canvas.
export function captureImage(app: AppBase): Promise<Blob> {
  const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    const destroyed = () => finish(new Error("The viewer closed before the capture completed."));
    const rendered = () => {
      app.off("destroy", destroyed);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The browser could not create the PNG.")), "image/png");
    };
    const finish = (error: Error) => { app.off("postrender", rendered); reject(error); };
    app.once("postrender", rendered);
    app.once("destroy", destroyed);
    app.renderNextFrame = true;
  });
}

export async function downloadCapture(app: AppBase, name: string): Promise<void> {
  const url = URL.createObjectURL(await captureImage(app));
  const link = document.createElement("a");
  link.href = url; link.download = captureFilename(name); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
