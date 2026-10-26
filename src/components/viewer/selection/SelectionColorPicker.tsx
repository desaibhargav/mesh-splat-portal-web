import { useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { selectionColors } from "./selectionColors";

export function SelectionColorPicker({ onApply, onReset, disabled }: {
  onApply(color: string): void; onReset?(): void; disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [color, setColor] = useState("#e53935");
  const valid = /^#[0-9a-f]{6}$/i.test(color);
  return <fieldset className="selection-palette" disabled={disabled}>
    <legend>Color selection</legend>
    <div className="selection-swatches">{selectionColors.map(entry => <button type="button" key={entry.name} title={entry.name}
      aria-label={`Color selection ${entry.name.toLowerCase()}`} style={{ backgroundColor: entry.hex }}
      onClick={() => { setColor(entry.hex); onApply(entry.hex); }} />)}</div>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Custom color</button>
    {expanded && <div className="selection-custom-color">
      <div onPointerUp={() => { if (valid) onApply(color); }}><HexColorPicker color={color} onChange={setColor} /></div>
      <label>Hex color<HexColorInput color={color} onChange={setColor} prefixed
        onBlur={() => { if (valid) onApply(color); }}
        onKeyDown={event => { if (event.key === "Enter" && valid) onApply(color); }} /></label>
    </div>}
    {onReset && <button type="button" title="Remove applied color" aria-label="Remove Color" className="tool-action-reset" onClick={onReset}>Remove Color</button>}
  </fieldset>;
}
