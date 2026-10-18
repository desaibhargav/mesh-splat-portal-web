import { Vec3 } from "playcanvas";
import type { SelectionSnapshot } from "../selection/types";

export interface AnnotationRecord {
  id: number; title: string; text: string; position: Vec3; region: SelectionSnapshot | null;
  color?: string | null; visible: boolean;
}
export type AnnotationDraft = Omit<AnnotationRecord, "id" | "position" | "visible"> & {
  id?: number; position: Vec3 | null; visible?: boolean;
};

export class Annotations {
  private snapshots: AnnotationRecord[][] = [[]];
  private cursor = 0;
  private nextId = 1;
  get records(): readonly AnnotationRecord[] { return this.snapshots[this.cursor]!; }
  save(draft: AnnotationDraft) {
    if (!draft.position) throw new Error("Place the annotation marker on a surface.");
    if (!draft.title.trim()) throw new Error("Enter an annotation title.");
    const record: AnnotationRecord = { ...draft, id: draft.id ?? this.nextId++, title: draft.title.trim(), text: draft.text.trim(),
      position: draft.position.clone(), visible: draft.visible ?? true };
    this.change(draft.id === undefined ? [...this.records, record] : this.records.map(item => item.id === record.id ? record : item));
  }
  remove(id: number) { this.change(this.records.filter(item => item.id !== id)); }
  rename(id: number, title: string) {
    const value = title.trim();
    if (value && this.records.find(record => record.id === id)?.title !== value) {
      this.change(this.records.map(record => record.id === id ? { ...record, title: value } : record));
    }
  }
  setVisible(id: number, visible: boolean) {
    if (this.records.find(record => record.id === id)?.visible !== visible) {
      this.change(this.records.map(record => record.id === id ? { ...record, visible } : record));
    }
  }
  undo() { if (this.cursor > 0) this.cursor--; }
  redo() { if (this.cursor + 1 < this.snapshots.length) this.cursor++; }
  private change(records: AnnotationRecord[]) {
    this.snapshots.splice(++this.cursor);
    this.snapshots.push(records);
  }
}
