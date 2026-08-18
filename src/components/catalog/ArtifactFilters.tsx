import type { ArtifactType } from "../../api/artifacts";

interface ArtifactFiltersProps {
  value?: ArtifactType;
  onChange(value?: ArtifactType): void;
}

export function ArtifactFilters({ value, onChange }: ArtifactFiltersProps) {
  return (
    <fieldset className="artifact-filters">
      <legend>Format</legend>
      {[
        ["", "All"],
        ["mesh", "Meshes"],
        ["splat", "Splats"]
      ].map(([filterValue, label]) => (
        <label key={filterValue || "all"}>
          <input
            checked={(value ?? "") === filterValue}
            name="artifact-type"
            type="radio"
            value={filterValue}
            onChange={() => onChange((filterValue || undefined) as ArtifactType | undefined)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
