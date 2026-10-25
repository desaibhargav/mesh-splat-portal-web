import { expect, it, vi } from "vitest";
import type { AppBase } from "playcanvas";
import { measurementAppearance } from "./measurementAppearance";

it("keeps endpoint and label metrics available when immersive presentation loses inherited CSS", () => {
  let attached = true;
  vi.stubGlobal("getComputedStyle", () => ({ fontFamily: "Arial", getPropertyValue: (key: string) => attached ?
    key === "--measurement-marker-size" ? "10px" : "12px" : "" }));
  try {
    const app = { graphicsDevice: { canvas: {} } } as AppBase;
    const before = measurementAppearance(app); attached = false;
    expect(measurementAppearance(app)).toEqual({ markerSize: 10, gap: 12, font: "Arial" });
    expect(measurementAppearance(app)).toBe(before);
  } finally { vi.unstubAllGlobals(); }
});
