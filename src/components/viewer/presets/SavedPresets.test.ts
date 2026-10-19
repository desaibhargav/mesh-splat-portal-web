import { expect, it, vi } from "vitest";
import { SavedPresets } from "./SavedPresets";

it("renames saved snapshots without restoring the camera or plane", () => {
  const presets = new SavedPresets<{ id: number; name: string; offset: number }>();
  const opened = vi.fn(); presets.on("open", opened);
  const first = presets.save({ name: "First cut", offset: .25 });
  const second = presets.save({ name: "Second cut", offset: -.5 });
  presets.rename(first.id, "Renamed cut");
  expect(opened).not.toHaveBeenCalled();
  expect(presets.records.map(record => record.offset)).toEqual([.25, -.5]);
  presets.open(first.id);
  expect(opened.mock.calls[0]![0]).toEqual({ ...first, name: "Renamed cut" });
  expect(presets.activeId).toBe(first.id);
  presets.remove(second.id);
  expect(presets.activeId).toBe(first.id);
  presets.remove(first.id);
  expect(presets.activeId).toBeNull();
});

it("updates a saved entry without duplicating it and closes without deleting it", () => {
  const presets = new SavedPresets<{ id: number; name: string }>();
  const first = presets.save({ name: "Orientation" });
  presets.save({ ...first, name: "Updated orientation" });
  presets.close();
  expect(presets.records).toEqual([{ id: first.id, name: "Updated orientation" }]);
  expect(presets.activeId).toBeNull();
});

it("toggles scene visibility without opening an editor or restoring a camera", () => {
  const presets = new SavedPresets<{ id: number; name: string }>();
  const opened = vi.fn(), visibility = vi.fn();
  presets.on("open", opened); presets.on("visibility", visibility);
  const first = presets.save({ name: "First cut" });
  const second = presets.save({ name: "Second cut" });
  presets.setVisible(first.id, true);
  expect(presets.activeId).toBe(first.id);
  expect(visibility.mock.calls.at(-1)![0]).toBe(first);
  presets.setVisible(second.id, false);
  expect(presets.activeId).toBe(first.id);
  presets.setVisible(first.id, false);
  expect(visibility.mock.calls.at(-1)![0]).toBeNull();
  expect(presets.activeId).toBeNull();
  expect(opened).not.toHaveBeenCalled();
});
