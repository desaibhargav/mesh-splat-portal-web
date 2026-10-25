import { expect, it } from "vitest";
import { Vec3 } from "playcanvas";
import { Annotations } from "./Annotations";
import { packSelection, unpackSelection } from "../selection/SelectionHistory";

it("retains an independent region and anchor when the current selection changes", () => {
  const annotations = new Annotations(), position = new Vec3(1, 2, 3);
  const state = { masks: [new Uint8Array([255, 0, 255]), new Uint8Array([0, 255])], isolated: true };
  annotations.save({ title: " Region ", text: " <b>plain text</b> ", position, region: packSelection(state) });
  position.set(0, 0, 0); state.masks.forEach(mask => mask.fill(0));
  const saved = annotations.records[0]!;
  expect(saved.title).toBe("Region"); expect(saved.text).toBe("<b>plain text</b>");
  expect(saved.position.toArray()).toEqual([1, 2, 3]);
  expect(unpackSelection(saved.region!)).toEqual({ masks: [new Uint8Array([255, 0, 255]), new Uint8Array([0, 255])], isolated: true });
  const restored = unpackSelection(saved.region!); restored.masks[0]!.fill(0);
  expect(unpackSelection(saved.region!).masks[0]![0]).toBe(255);
});

it("undoes and redoes annotation creation, edits, and deletion without reusing IDs", () => {
  const annotations = new Annotations();
  const draft = { title: "First", text: "Note", position: new Vec3(), region: null };
  annotations.save(draft); const first = annotations.records[0]!;
  annotations.save({ ...first, title: "Edited" });
  annotations.undo(); expect(annotations.records[0]!.title).toBe("First");
  annotations.redo(); expect(annotations.records[0]!.title).toBe("Edited");
  annotations.remove(first.id); expect(annotations.records).toHaveLength(0);
  annotations.undo(); expect(annotations.records).toHaveLength(1);
  annotations.undo(); annotations.undo(); expect(annotations.records).toHaveLength(0);
  annotations.save({ ...draft, title: "Second" }); annotations.redo();
  expect(annotations.records).toHaveLength(1); expect(annotations.records[0]!.id).not.toBe(first.id);
  expect(() => annotations.save({ ...draft, title: " " })).toThrow("Enter an annotation title.");
  expect(() => annotations.save({ ...draft, position: null })).toThrow("Place the annotation marker");
});

it("renames annotations and controls marker visibility without changing their content", () => {
  const annotations = new Annotations();
  annotations.save({ title: "Original", text: "Note", position: new Vec3(), region: null });
  const id = annotations.records[0]!.id;
  annotations.rename(id, "Feature"); annotations.setVisible(id, false);
  expect(annotations.records[0]).toMatchObject({ title: "Feature", text: "Note", visible: false });
  annotations.undo(); expect(annotations.records[0]!.visible).toBe(true);
});

it("deletes linked region notes while retaining point notes and other selections", () => {
  const annotations = new Annotations();
  const region = { isolated: false, masks: [{ bits: new Uint8Array([1]), length: 1 }] };
  annotations.save({ title: "Linked", text: "", position: new Vec3(), region, selectionId: 7 });
  annotations.save({ title: "Other", text: "", position: new Vec3(), region, selectionId: 8 });
  annotations.save({ title: "Point", text: "", position: new Vec3(), region: null });
  annotations.removeForSelection(7, region);
  expect(annotations.records.map(record => record.title)).toEqual(["Other", "Point"]);
});
