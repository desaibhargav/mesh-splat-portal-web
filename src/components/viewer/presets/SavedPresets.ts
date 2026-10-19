import { EventHandler } from "playcanvas";

// Session-owned snapshots. Opening a preset is an explicit operation, separate
// from renaming it; editing a name must never move the camera or cutting plane.
export class SavedPresets<T extends { id: number; name: string }> extends EventHandler {
  records: readonly T[] = [];
  activeId: number | null = null;
  save(value: Omit<T, "id"> & { id?: number }) {
    const record = { ...value, id: value.id ?? Math.max(0, ...this.records.map(item => item.id)) + 1 } as T;
    this.records = this.records.some(item => item.id === record.id)
      ? this.records.map(item => item.id === record.id ? record : item) : [...this.records, record];
    this.activeId = record.id; this.fire("change");
    return record;
  }
  open(id: number) {
    const record = this.records.find(item => item.id === id);
    if (!record) return;
    this.activeId = id; this.fire("open", record); this.fire("change");
  }
  close() { this.activeId = null; this.fire("close"); this.fire("change"); }
  rename(id: number, name: string) {
    if (!name.trim()) return;
    this.records = this.records.map(item => item.id === id ? { ...item, name: name.trim() } : item);
    this.fire("change");
  }
  remove(id: number) {
    this.records = this.records.filter(item => item.id !== id);
    if (this.activeId === id) this.close();
    else this.fire("change");
  }
}
