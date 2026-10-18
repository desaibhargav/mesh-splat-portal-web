import { Vec3 } from "playcanvas";
import type { SelectionSnapshot } from "../selection/SelectionHistory";

export interface AnnotationRecord {
  id: number; title: string; text: string; position: Vec3; region: SelectionSnapshot | null;
}
export type AnnotationDraft = Omit<AnnotationRecord, "id"> & { id?: number };

export class Annotations {
  private snapshots: AnnotationRecord[][] = [[]];
  private cursor = 0;
  private nextId = 1;
  get records(): readonly AnnotationRecord[] { return this.snapshots[this.cursor]!; }
  save(draft: AnnotationDraft) {
    const record: AnnotationRecord = { ...draft, id: draft.id ?? this.nextId++, title: draft.title.trim(), text: draft.text.trim(), position: draft.position.clone() };
    if (!record.title) throw new Error("Enter an annotation title.");
    this.change(draft.id === undefined ? [...this.records, record] : this.records.map(item => item.id === record.id ? record : item));
  }
  remove(id: number) { this.change(this.records.filter(item => item.id !== id)); }
  undo() { if (this.cursor > 0) this.cursor--; }
  redo() { if (this.cursor + 1 < this.snapshots.length) this.cursor++; }
  private change(records: AnnotationRecord[]) {
    this.snapshots.splice(++this.cursor);
    this.snapshots.push(records);
  }
}
