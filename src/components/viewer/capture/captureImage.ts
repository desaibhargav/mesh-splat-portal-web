import { Vec3, type AppBase } from "playcanvas";
import type { AnnotationRecord } from "../annotations/Annotations";
import type { SelectionHandle } from "../selection/types";

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

function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > width) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function captureImageWithAnnotations(handle: SelectionHandle, records: readonly AnnotationRecord[]): Promise<Blob> {
  const image = await createImageBitmap(await captureImage(handle.app));
  const output = document.createElement("canvas"); output.width = image.width; output.height = image.height;
  const context = output.getContext("2d")!; context.drawImage(image, 0, 0); image.close();
  const source = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
  const scale = output.width / source.clientWidth, marker = 13 * scale, padding = 9 * scale, lineHeight = 17 * scale;
  const point = new Vec3(), screen = new Vec3();
  context.font = `${13 * scale}px sans-serif`; context.textBaseline = "top";
  for (const panel of handle.viewports.visible) for (const [index, record] of records.filter(item => item.visible).entries()) {
    handle.space.toWorld(record.position, point);
    if (point.clone().sub(panel.camera.entity.getPosition()).dot(panel.camera.entity.forward) <= 0) continue;
    panel.camera.worldToScreen(point, screen);
    screen.x *= scale; screen.y *= scale;
    const title = `${index + 1}. ${record.title}`, lines = [title, ...wrap(context, record.text, 260 * scale)];
    const textWidth = Math.max(...lines.map(line => context.measureText(line).width));
    const boxWidth = textWidth + padding * 2, boxHeight = lines.length * lineHeight + padding * 2;
    let x = screen.x + marker * 1.5, y = screen.y - marker;
    x = Math.min(x, output.width - boxWidth - padding); y = Math.min(Math.max(padding, y), output.height - boxHeight - padding);
    context.fillStyle = record.color ?? "#d6b85a"; context.beginPath(); context.arc(screen.x, screen.y, marker, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#111"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(String(index + 1), screen.x, screen.y);
    context.fillStyle = "rgba(24,24,24,.92)"; context.fillRect(x, y, boxWidth, boxHeight);
    context.strokeStyle = record.color ?? "#d6b85a"; context.strokeRect(x, y, boxWidth, boxHeight);
    context.fillStyle = "#fff"; context.textAlign = "left"; context.textBaseline = "top";
    lines.forEach((line, lineIndex) => context.fillText(line, x + padding, y + padding + lineIndex * lineHeight));
  }
  return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error("The browser could not create the annotated PNG.")), "image/png"));
}

export async function downloadCapture(handle: SelectionHandle, name: string, records?: readonly AnnotationRecord[]): Promise<void> {
  const blob = records ? await captureImageWithAnnotations(handle, records) : await captureImage(handle.app);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = captureFilename(name); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
