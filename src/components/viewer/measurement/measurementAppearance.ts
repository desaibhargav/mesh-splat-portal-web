import type { AppBase } from "playcanvas";

interface Appearance { markerSize: number; gap: number; font: string }
const appearances = new WeakMap<AppBase, Appearance>();

// Read inherited CSS before immersive entry, where computed style can be
// unavailable. First-point renderers reuse these metrics instead of querying it then.
export function measurementAppearance(app: AppBase): Appearance {
  let appearance = appearances.get(app);
  if (!appearance) {
    const style = getComputedStyle(app.graphicsDevice.canvas);
    appearance = { markerSize: parseFloat(style.getPropertyValue("--measurement-marker-size")),
      gap: parseFloat(style.getPropertyValue("--measurement-label-gap")), font: style.fontFamily };
    if (!Number.isFinite(appearance.markerSize) || !Number.isFinite(appearance.gap)) throw new Error("Measurement visual style is unavailable.");
    appearances.set(app, appearance);
  }
  return appearance;
}
