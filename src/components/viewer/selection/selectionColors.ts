import type { SelectionArea, SelectionState } from "./types";
import { packSelection, snapshotContains, unpackSelection } from "./selectionSnapshot";

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
export function paintSelection(colors: PaintState, masks: readonly Uint8Array[], color: number): PaintState {
  if (!Number.isInteger(color) || color < 0 || color > 0x1000000) throw new Error("Unknown selection color.");
  let changed = false;
  const next = colors.map((values, part) => {
    const mask = masks[part]!;
    if (!mask.some((selected, i) => selected !== 0 && (color ? !values[i] : !!values[i]))) return values;
    changed = true;
    return values.map((value, i) => mask[i] && (!color || !value) ? color : value);
  });
  return changed ? next : colors;
}

export function updateSelectionAreas(areas: readonly SelectionArea[], colors: PaintState,
  masks: readonly Uint8Array[], color: number): readonly SelectionArea[] {
  if (!color) return areas.flatMap(area => {
    const next = unpackSelection(area.snapshot).masks.map((mask, part) => mask.map((value, i) => masks[part]![i] ? 0 : value));
    return next.some(mask => mask.some(Boolean)) ? [{ ...area, snapshot: packSelection({ masks: next, isolated: false }) }] : [];
  });
  const selected = masks.map((mask, part) => mask.map((value, i) => value && !colors[part]![i] ? 255 : 0));
  if (!selected.some(mask => mask.some(Boolean))) return areas;
  const id = areas.reduce((maximum, area) => Math.max(maximum, area.id), 0) + 1;
  return [...areas, { id, color, snapshot: packSelection({ masks: selected, isolated: false }) }];
}

export function selectionAreaAt(areas: readonly SelectionArea[], part: number, index: number): SelectionArea | null {
  for (let i = areas.length - 1; i >= 0; i--) if (snapshotContains(areas[i]!.snapshot, part, index)) return areas[i]!;
  return null;
}

export function currentSelectionArea(state: SelectionState, areas: readonly SelectionArea[]): SelectionArea | null {
  const claimed = state.masks.map(mask => new Uint8Array(Math.ceil(mask.length / 8)));
  for (const area of areas) area.snapshot.masks.forEach((mask, part) => {
    const target = claimed[part]!;
    mask.bits.forEach((byte, i) => { target[i] = target[i]! | byte; });
  });
  const masks = state.masks.map((mask, part) => mask.map((selected, i) =>
    selected && !(claimed[part]![i >> 3]! & (1 << (i & 7))) ? 255 : 0));
  return masks.some(mask => mask.some(Boolean)) ?
    { id: 0, color: 0, snapshot: packSelection({ masks, isolated: false }) } : null;
}
