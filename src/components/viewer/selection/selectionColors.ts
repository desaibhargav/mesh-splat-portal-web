import type { SelectionArea, SelectionState } from "./types";
import type { SelectionOperation } from "./rectangle";
import { packSelection, selectionsEqual, snapshotContains } from "./selectionSnapshot";

export const selectionColors = [
  { name: "Red", hex: "#e53935" }, { name: "Orange", hex: "#fb8c00" },
  { name: "Yellow", hex: "#fdd835" }, { name: "Green", hex: "#43a047" },
  { name: "Blue", hex: "#1e88e5" }, { name: "Purple", hex: "#8e24aa" },
  { name: "Pink", hex: "#d81b60" }, { name: "Gray", hex: "#808080" }
] as const;

// RGB + 1 represents every sRGB shade, including black; zero restores the source.
// Immutable buffers share unchanged paint data across undo snapshots.
export type PaintState = readonly Uint32Array[];
export function encodeColor(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Use a six-digit hex color.");
  return parseInt(hex.slice(1), 16) + 1;
}
export function decodeColor(color: number): string {
  return `#${(color - 1).toString(16).padStart(6, "0")}`;
}
export function paintSelection(colors: PaintState, masks: readonly Uint8Array[], color: number, replaceColor = 0): PaintState {
  if (!Number.isInteger(color) || color < 0 || color > 0x1000000) throw new Error("Unknown selection color.");
  function applies(value: number, selected: number) {
    if (!selected || value === color) return false;
    if (!color) return replaceColor ? value === replaceColor : Boolean(value);
    return !value || Boolean(replaceColor && value === replaceColor);
  }
  let changed = false;
  const next = colors.map((values, part) => {
    const mask = masks[part]!;
    if (!mask.some((selected, i) => applies(values[i]!, selected))) return values;
    changed = true;
    return values.map((value, i) => applies(value, mask[i]!) ? color : value);
  });
  return changed ? next : colors;
}

export function updateSelectionAreas(areas: readonly SelectionArea[], colors: PaintState,
  masks: readonly Uint8Array[], color: number): readonly SelectionArea[] {
  const snapshot = packSelection({ masks: [...masks], isolated: false });
  const existing = areas.findIndex(area => selectionsEqual(area.snapshot, snapshot));
  if (!color) return existing < 0 ? areas : areas.map((area, index) => index === existing ? { ...area, color: 0 } : area);
  if (existing >= 0) return areas.map((area, index) => index === existing ? { ...area, color } : area);
  const selected = masks.map((mask, part) => mask.map((value, i) => value && !colors[part]![i] ? 255 : 0));
  if (!selected.some(mask => mask.some(Boolean))) return areas;
  const id = areas.reduce((maximum, area) => Math.max(maximum, area.id), 0) + 1;
  return [...areas, { id, name: `Selection ${id}`, visible: true, color,
    snapshot: packSelection({ masks: selected, isolated: false }) }];
}

export function recordSelectionArea(areas: readonly SelectionArea[], state: SelectionState): readonly SelectionArea[] {
  if (!state.masks.some(mask => mask.some(Boolean))) return areas;
  const snapshot = packSelection({ masks: [...state.masks], isolated: false });
  const existing = areas.findIndex(area => selectionsEqual(area.snapshot, snapshot));
  if (existing >= 0) return areas[existing]!.visible ? areas :
    areas.map((area, index) => index === existing ? { ...area, visible: true } : area);
  const id = areas.reduce((maximum, area) => Math.max(maximum, area.id), 0) + 1;
  return [...areas, { id, name: `Selection ${id}`, visible: true, color: 0, snapshot }];
}

// Promote the current region, reusing its packed mask and paint metadata. Editing
// a saved entry replaces that entry; unchanged regions and snapshots stay shared.
export function saveSelectionArea(areas: readonly SelectionArea[], state: SelectionState,
  name: string, editing: number | null): readonly SelectionArea[] {
  if (!name.trim() || !state.masks.some(mask => mask.some(Boolean))) return areas;
  const snapshot = packSelection({ masks: state.masks, isolated: false });
  const matching = areas.find(area => selectionsEqual(area.snapshot, snapshot));
  const previous = areas.find(area => area.id === editing) ?? matching;
  const record: SelectionArea = { id: previous?.id ?? areas.reduce((max, area) => Math.max(max, area.id), 0) + 1,
    name: name.trim(), saved: true, visible: true, color: matching?.color ?? 0,
    snapshot: matching?.snapshot ?? snapshot };
  return [...areas.filter(area => area.id !== record.id && (area.saved || area !== matching)), record];
}

// Draft areas describe one selection gesture, while the active mask may contain
// several Shift-added gestures. Keeping those concepts separate lets a user
// address, color, annotate, and hover each area independently.
export function recordSelectionGesture(areas: readonly SelectionArea[], state: SelectionState,
  operation: SelectionOperation, previous?: readonly Uint8Array[]): readonly SelectionArea[] {
  if (operation !== "set" && operation !== "add") return areas;
  const masks = operation === "set" ? state.masks : state.masks.map((mask, part) =>
    mask.map((selected, index) => selected && !previous?.[part]?.[index] ? 255 : 0));
  return recordSelectionArea(areas, { masks, isolated: false });
}

export function visiblePaint(colors: PaintState, areas: readonly SelectionArea[]): PaintState {
  const hidden = areas.filter(area => !area.visible);
  if (!hidden.length) return colors;
  const next = colors.map(values => values.slice());
  for (const area of hidden) area.snapshot.masks.forEach((mask, part) => {
    if (!area.color) return;
    mask.bits.forEach((byte, offset) => {
      if (!byte) return;
      for (let bit = 0; bit < 8; bit++) {
        const index = offset * 8 + bit;
        if (index < mask.length && (byte & (1 << bit)) && next[part]![index] === area.color) next[part]![index] = 0;
      }
    });
  });
  return next;
}

export function visibleSelections(areas: readonly SelectionArea[], lengths: readonly number[]): Uint8Array[] {
  const packed = lengths.map(length => new Uint8Array(Math.ceil(length / 8)));
  for (const area of areas) if (area.visible && !area.color) area.snapshot.masks.forEach((mask, part) => {
    const target = packed[part]!;
    mask.bits.forEach((byte, index) => { target[index] = target[index]! | byte; });
  });
  return lengths.map((length, part) => {
    const mask = new Uint8Array(length), bits = packed[part]!;
    for (let index = 0; index < length; index++) if (bits[index >> 3]! & (1 << (index & 7))) mask[index] = 255;
    return mask;
  });
}

export function selectionAreaAt(areas: readonly SelectionArea[], part: number, index: number): SelectionArea | null {
  for (let i = areas.length - 1; i >= 0; i--) if (snapshotContains(areas[i]!.snapshot, part, index)) return areas[i]!;
  return null;
}

export function currentSelectionArea(state: SelectionState, areas: readonly SelectionArea[]): SelectionArea | null {
  const snapshot = packSelection({ masks: [...state.masks], isolated: false });
  const exact = areas.find(area => selectionsEqual(area.snapshot, snapshot));
  if (exact) return exact;
  const claimed = state.masks.map(mask => new Uint8Array(Math.ceil(mask.length / 8)));
  for (const area of areas) area.snapshot.masks.forEach((mask, part) => {
    const target = claimed[part]!;
    mask.bits.forEach((byte, i) => { target[i] = target[i]! | byte; });
  });
  const masks = state.masks.map((mask, part) => mask.map((selected, i) =>
    selected && !(claimed[part]![i >> 3]! & (1 << (i & 7))) ? 255 : 0));
  return masks.some(mask => mask.some(Boolean)) ?
    { id: 0, name: "Current selection", visible: true, color: 0,
      snapshot: packSelection({ masks, isolated: false }) } : null;
}

// Explicitly saved regions own persistent selection/paint state. Draft paint is
// masked out on exit without changing overlapping saved regions or their buffers.
export function savedSelectionColors(colors: PaintState, areas: readonly SelectionArea[]): PaintState {
  if (areas.every(area => area.saved)) return colors;
  const saved = visibleSelections(areas.filter(area => area.saved).map(area => ({ ...area, visible: true, color: 0 })), colors.map(values => values.length));
  return colors.map((values, part) => values.some((value, index) => value && !saved[part]![index])
    ? values.map((value, index) => saved[part]![index] ? value : 0) : values);
}
