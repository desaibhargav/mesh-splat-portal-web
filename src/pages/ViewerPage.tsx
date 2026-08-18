import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getArtifact } from "../api/artifacts";
import { ArtifactViewer } from "../components/viewer/ArtifactViewer";

export function ViewerPage() {
  const { artifactId } = useParams();
  const artifact = useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: ({ signal }) => getArtifact(artifactId ?? "", signal),
    enabled: Boolean(artifactId)
  });

  if (artifact.isPending) return <p className="page" role="status">Loading artifact…</p>;
  if (artifact.isError || !artifact.data) return <p className="page" role="alert">Artifact unavailable.</p>;

  return (
    <section className="page viewer-page">
      <Link className="back-link" to="/">← Back to collection</Link>
      <div className="viewer-heading">
        <div><p className="eyebrow">{artifact.data.type === "mesh" ? "Traditional mesh" : "Gaussian splat"}</p><h1>{artifact.data.title}</h1></div>
        <p>{formatBytes(artifact.data.sizeBytes)}</p>
      </div>
      <ArtifactViewer artifact={artifact.data} />
      <section className="metadata-panel"><h2>About this object</h2><p>{artifact.data.description}</p></section>
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
