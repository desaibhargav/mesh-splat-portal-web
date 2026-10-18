import { useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { selectionColors } from "./selectionColors";

export function SelectionColorPicker({ onApply, onReset, disabled }: {
  onApply(color: string): void; onReset(): void; disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [color, setColor] = useState("#e53935");
  return <fieldset className="selection-palette" disabled={disabled}>
    <legend>Color selection</legend>
    <div className="selection-swatches">{selectionColors.map(entry => <button type="button" key={entry.name} title={entry.name}
      aria-label={`Color selection ${entry.name.toLowerCase()}`} style={{ backgroundColor: entry.hex }}
      onClick={() => { setColor(entry.hex); onApply(entry.hex); }} />)}</div>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Custom color</button>
    {expanded && <div className="selection-custom-color">
      <HexColorPicker color={color} onChange={setColor} />
      <label>Hex color<HexColorInput color={color} onChange={setColor} prefixed /></label>
      <button type="button" onClick={() => onApply(color)} style={{ borderColor: color }}>Apply color</button>
    </div>}
    <button type="button" title="Restore original color in selection" aria-label="Restore original color in selection" onClick={onReset}>Restore original</button>
  </fieldset>;
}
