import { useId } from "react";
import { ResetButton } from "./ResetButton";

export function SliderControl({ label, ariaLabel = label, min, max, value, unit = "", defaultValue, disabled, onChange }: {
  label: string; ariaLabel?: string; min: number; max: number; value: number; unit?: string;
  defaultValue?: number; disabled?: boolean; onChange(value: number): void;
}) {
  const id = useId();
  return <div className="tool-slider">
    <label htmlFor={id}>{label}:</label>
    <input id={id} aria-label={ariaLabel} type="range" min={min} max={max} step="1" value={value} disabled={disabled}
      onChange={event => onChange(Number(event.target.value))} />
    <output htmlFor={id}>{value}{unit}</output>
    {defaultValue !== undefined && <ResetButton label={`Reset ${label.toLowerCase()}`} disabled={disabled || value === defaultValue}
      onClick={() => onChange(defaultValue)} />}
  </div>;
}
