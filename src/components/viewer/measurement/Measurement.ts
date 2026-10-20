import { defaultMeasurementStyle } from "./measurementStyle";
import { BoundingBox, Vec3 } from "playcanvas";

export interface MeasurementRecord {
  id: number; name: string; visible: boolean; saved: boolean; points: readonly Vec3[];
}

export class Measurement {
  style = defaultMeasurementStyle;
  private snapshots: MeasurementRecord[][] = [[]];
  private cursor = 0;
  private nextId = 1;
  get records(): readonly MeasurementRecord[] { return this.snapshots[this.cursor]!; }
  get segments(): readonly (readonly Vec3[])[] { return this.records.map(record => record.points); }
  get visibleSegments(): readonly (readonly Vec3[])[] { return this.records.filter(record => record.visible).map(record => record.points); }
  get points(): readonly Vec3[] { return this.records.at(-1)?.points ?? []; }
  get distance(): number | null { return this.points.length === 2 ? this.points[0]!.distance(this.points[1]!) : null; }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor + 1 < this.snapshots.length; }
  add(point: Vec3, additional = false) {
    if (this.points.length === 2) {
      if (additional) this.change([...this.records.map(record => record.id === this.records.at(-1)!.id ? { ...record, saved: true } : record), this.create([point.clone()])]);
    } else if (!this.records.length) this.change([this.create([point.clone()])]);
    else this.change([...this.records.slice(0, -1), { ...this.records.at(-1)!, points: [...this.points, point.clone()] }]);
  }
  save(id: number, name: string) {
    const previous = this.records.find(record => record.id === id);
    if (!name.trim() || previous?.points.length !== 2 || (previous.saved && previous.name === name.trim())) return;
    this.change(this.records.map(record => record.id === id
      ? { ...record, name: name.trim(), saved: true } : record));
  }
  moveEndpoint(id: number, index: number, point: Vec3) {
    const record = this.records.find(record => record.id === id);
    const previous = record?.points[index];
    if (!previous || previous.equals(point)) return;
    this.change(this.records.map(item => item.id === id ? { ...item,
      points: item.points.map((value, i) => i === index ? point.clone() : value) } : item));
  }
  remove(id: number) {
    if (this.records.some(record => record.id === id)) this.change(this.records.filter(record => record.id !== id));
  }
  clear() { if (this.records.length) this.change([]); }
  rename(id: number, name: string) {
    const value = name.trim();
    if (value && this.records.find(record => record.id === id)?.name !== value) {
      this.change(this.records.map(record => record.id === id ? { ...record, name: value } : record));
    }
  }
  setVisible(id: number, visible: boolean) {
    if (this.records.find(record => record.id === id)?.visible !== visible) {
      this.change(this.records.map(record => record.id === id ? { ...record, visible } : record));
    }
  }
  undo() { if (this.canUndo) this.cursor--; }
  redo() { if (this.canRedo) this.cursor++; }
  bounds(): BoundingBox | null {
    const points = this.records.filter(record => record.visible).flatMap(record => record.points);
    if (!points.length) return null;
    const min = points[0]!.clone(), max = min.clone();
    for (const point of points) { min.min(point); max.max(point); }
    const bounds = new BoundingBox(); bounds.setMinMax(min, max); return bounds;
  }
  private create(points: readonly Vec3[]): MeasurementRecord {
    const id = this.nextId++;
    return { id, name: `Measurement ${id}`, visible: true, saved: false, points };
  }
  private change(points: MeasurementRecord[]) {
    this.snapshots.splice(++this.cursor);
    this.snapshots.push(points);
  }
}

export function formatDistance(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(value);
}
