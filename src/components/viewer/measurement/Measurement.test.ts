import { expect, it } from "vitest";
import { Vec3 } from "playcanvas";
import { Measurement, formatDistance } from "./Measurement";

it("measures world-space distance, clones endpoints, and waits for two points", () => {
  const measurement = new Measurement(), first = new Vec3(10, 20, 30);
  expect(measurement.distance).toBeNull(); expect(measurement.bounds()).toBeNull();
  measurement.add(first); first.set(0, 0, 0);
  expect(measurement.distance).toBeNull();
  measurement.add(new Vec3(13, 24, 30));
  expect(measurement.distance).toBe(5);
  measurement.add(new Vec3(100, 0, 0)); expect(measurement.points).toHaveLength(2);
  expect(measurement.bounds()!.center.toArray()).toEqual([11.5, 22, 30]);
});
it("undoes and redoes endpoints and Clear, and replaces redo after a new point", () => {
  const measurement = new Measurement();
  measurement.clear(); expect(measurement.canUndo).toBe(false);
  measurement.add(new Vec3()); measurement.add(new Vec3(0, 0, 2)); measurement.clear();
  measurement.undo(); expect(measurement.distance).toBe(2);
  measurement.undo(); expect(measurement.points).toHaveLength(1);
  measurement.redo(); expect(measurement.distance).toBe(2);
  measurement.undo(); measurement.add(new Vec3(0, 3, 0));
  expect(measurement.canRedo).toBe(false); expect(measurement.distance).toBe(3);
});
it("preserves zero length and formats tiny and large model-space distances", () => {
  const measurement = new Measurement(); measurement.add(Vec3.ZERO); measurement.add(Vec3.ZERO);
  expect(measurement.distance).toBe(0);
  expect(formatDistance(.00000123456)).toBe("0.0000012346");
  expect(formatDistance(123456789)).toBe("123,460,000");
});

it("keeps completed segments when Shift starts another, including undo and redo", () => {
  const measurement = new Measurement();
  measurement.add(Vec3.ZERO); measurement.add(new Vec3(3, 0, 0));
  measurement.add(new Vec3(0, 4, 0), true);
  expect(measurement.segments).toHaveLength(2); expect(measurement.distance).toBeNull();
  measurement.add(new Vec3(0, 4, 5)); expect(measurement.distance).toBe(5);
  expect(measurement.segments[0]![0]!.distance(measurement.segments[0]![1]!)).toBe(3);
  expect(measurement.bounds()!.center.toArray()).toEqual([1.5, 2, 2.5]);
  measurement.undo(); expect(measurement.points).toHaveLength(1);
  measurement.undo(); expect(measurement.segments).toHaveLength(1);
  measurement.redo(); measurement.redo(); expect(measurement.distance).toBe(5);
  measurement.clear(); expect(measurement.segments).toHaveLength(0);
  measurement.undo(); expect(measurement.segments).toHaveLength(2);
});

it("names measurements and independently controls their scene visibility", () => {
  const measurement = new Measurement();
  measurement.add(Vec3.ZERO); measurement.add(Vec3.ONE);
  measurement.add(new Vec3(2, 0, 0), true); measurement.add(new Vec3(3, 0, 0));
  const first = measurement.records[0]!;
  measurement.rename(first.id, "Diameter"); measurement.setVisible(first.id, false);
  expect(measurement.records[0]).toMatchObject({ name: "Diameter", visible: false });
  expect(measurement.visibleSegments).toEqual([measurement.records[1]!.points]);
  measurement.undo(); expect(measurement.records[0]!.visible).toBe(true);
});

it("moves one endpoint as a single undoable edit without changing other measurements", () => {
  const measurement = new Measurement();
  measurement.add(Vec3.ZERO); measurement.add(new Vec3(3, 0, 0));
  const first = measurement.records[0]!;
  measurement.add(Vec3.ONE, true); measurement.add(new Vec3(1, 2, 1));
  const second = measurement.records[1]!;
  const position = new Vec3(0, 4, 0);
  measurement.moveEndpoint(first.id, 1, position); position.set(100, 100, 100);
  expect(measurement.records[0]!.points[1]!.toArray()).toEqual([0, 4, 0]);
  expect(measurement.records[1]).toBe(second);
  expect(first.points[1]!.toArray()).toEqual([3, 0, 0]);
  measurement.undo(); expect(measurement.records[0]).toEqual({ ...first, saved: true });
  measurement.redo(); expect(measurement.records[0]!.points[1]!.y).toBe(4);
  const state = measurement.records;
  measurement.moveEndpoint(first.id, 1, new Vec3(0, 4, 0));
  measurement.moveEndpoint(first.id, 5, Vec3.ZERO);
  expect(measurement.records).toBe(state);
});

it("saves measurements without hiding them, and supports undoable deletion", () => {
  const measurement = new Measurement();
  measurement.add(Vec3.ZERO); measurement.add(Vec3.ONE);
  const id = measurement.records[0]!.id;
  measurement.save(id, "Diagonal");
  expect(measurement.records[0]).toMatchObject({ name: "Diagonal", saved: true, visible: true });
  expect(measurement.visibleSegments).toHaveLength(1);
  const saved = measurement.records;
  measurement.save(id, "Diagonal"); expect(measurement.records).toBe(saved);
  measurement.remove(id); expect(measurement.visibleSegments).toHaveLength(0);
  measurement.undo(); expect(measurement.records).toBe(saved);
  measurement.setVisible(id, false); expect(measurement.visibleSegments).toHaveLength(0);
  expect(measurement.records[0]!.saved).toBe(true);
});

it("includes line and font adjustments in measurement undo history", () => {
  const measurement = new Measurement();
  const original = measurement.style;
  measurement.setStyle({ ...original, lineWidth: original.lineWidth + 1 });
  measurement.setStyle({ ...measurement.style, fontSize: original.fontSize + 2 });
  expect(measurement.style).toEqual({ lineWidth: original.lineWidth + 1, fontSize: original.fontSize + 2 });
  measurement.undo(); expect(measurement.style).toEqual({ lineWidth: original.lineWidth + 1, fontSize: original.fontSize });
  measurement.undo(); expect(measurement.style).toEqual(original);
  measurement.redo(); expect(measurement.style.lineWidth).toBe(original.lineWidth + 1);
});
