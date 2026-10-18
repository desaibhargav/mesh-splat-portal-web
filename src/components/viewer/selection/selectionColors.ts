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
    if (!mask.some((selected, i) => selected !== 0 && values[i] !== color)) return values;
    changed = true;
    return values.map((value, i) => mask[i] ? color : value);
  });
  return changed ? next : colors;
}

// Use the dominant painted shade for a mixed region; unpainted areas use the
// viewer's ordinary selection highlight, not the last palette choice.
export function selectionShade(colors: PaintState, masks: readonly Uint8Array[], highlight: string): string {
  const counts = new Map<number, number>();
  masks.forEach((mask, part) => mask.forEach((selected, i) => {
    if (selected) { const color = colors[part]![i]!; counts.set(color, (counts.get(color) ?? 0) + 1); }
  }));
  let dominant = 0, count = 0;
  for (const [color, total] of counts) if (total > count) { dominant = color; count = total; }
  return dominant ? decodeColor(dominant) : highlight;
}
