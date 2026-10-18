export const selectionColors = [
  { name: "Red", hex: "#e53935" }, { name: "Orange", hex: "#fb8c00" },
  { name: "Yellow", hex: "#fdd835" }, { name: "Green", hex: "#43a047" },
  { name: "Blue", hex: "#1e88e5" }, { name: "Purple", hex: "#8e24aa" },
  { name: "Pink", hex: "#d81b60" }, { name: "Gray", hex: "#808080" }
] as const;

// Zero retains the original material/color. Immutable buffers let undo snapshots
// share paint data across selection changes; only a paint edit copies a buffer.
export type PaintState = readonly Uint8Array[];
export function paintSelection(colors: PaintState, masks: readonly Uint8Array[], color: number): PaintState {
  if (!Number.isInteger(color) || color < 0 || color > selectionColors.length) throw new Error("Unknown selection color.");
  let changed = false;
  const next = colors.map((values, part) => {
    const mask = masks[part]!;
    if (!mask.some((selected, i) => selected !== 0 && values[i] !== color)) return values;
    changed = true;
    return values.map((value, i) => mask[i] ? color : value);
  });
  return changed ? next : colors;
}
