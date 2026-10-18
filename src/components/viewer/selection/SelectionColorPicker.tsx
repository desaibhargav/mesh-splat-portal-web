import { useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { selectionColors } from "./selectionColors";

export function SelectionColorPicker({ color, onChange, onApply, onReset, disabled }: {
  color: string; onChange(color: string): void; onApply(color: string): void; onReset(): void; disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return <fieldset className="selection-palette" disabled={disabled}>
    <legend>Color selection</legend>
    <div className="selection-swatches">{selectionColors.map(entry => <button key={entry.name} title={entry.name}
      aria-label={`Color selection ${entry.name.toLowerCase()}`} style={{ backgroundColor: entry.hex }}
      onClick={() => { onChange(entry.hex); onApply(entry.hex); }} />)}</div>
    <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Custom color</button>
    {expanded && <div className="selection-custom-color">
      <HexColorPicker color={color} onChange={onChange} />
      <label>Hex color<HexColorInput color={color} onChange={onChange} prefixed /></label>
      <button onClick={() => onApply(color)} style={{ borderColor: color }}>Apply color</button>
    </div>}
    <button title="Restore original color in selection" aria-label="Restore original color in selection" onClick={onReset}>Restore original</button>
  </fieldset>;
}
