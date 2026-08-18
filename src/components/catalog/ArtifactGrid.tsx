import type { Artifact } from "../../api/artifacts";
import { ArtifactCard } from "./ArtifactCard";

export function ArtifactGrid({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return <p>No artifacts match the current search.</p>;
  }

  return (
    <div className="artifact-grid">
      {artifacts.map((artifact) => (
        <ArtifactCard artifact={artifact} key={artifact.id} />
      ))}
    </div>
  );
}
