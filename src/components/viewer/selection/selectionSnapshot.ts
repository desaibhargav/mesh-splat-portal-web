import type { SelectionSnapshot, SelectionState } from "./types";

export function packSelection(state: SelectionState): SelectionSnapshot {
  return { isolated: state.isolated, masks: state.masks.map(mask => {
    const bits = new Uint8Array(Math.ceil(mask.length / 8));
    mask.forEach((value, i) => { if (value) bits[i >> 3]! |= 1 << (i & 7); });
    return { bits, length: mask.length };
  }) };
}

export function unpackSelection(snapshot: SelectionSnapshot): SelectionState {
  return { isolated: snapshot.isolated, masks: snapshot.masks.map(({ bits, length }) =>
    Uint8Array.from({ length }, (_, i) => bits[i >> 3]! & (1 << (i & 7)) ? 255 : 0)) };
}

export function selectionsEqual(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return a.isolated === b.isolated && a.masks.every((mask, i) =>
    mask.length === b.masks[i]?.length && mask.bits.every((value, j) => value === b.masks[i]!.bits[j]));
}

export function snapshotContains(snapshot: SelectionSnapshot, part: number, index: number): boolean {
  const mask = snapshot.masks[part];
  return !!mask && index < mask.length && !!(mask.bits[index >> 3]! & (1 << (index & 7)));
}
