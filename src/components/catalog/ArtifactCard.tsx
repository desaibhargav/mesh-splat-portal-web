import { Link } from "react-router-dom";
import { useState } from "react";
import type { Artifact } from "../../api/artifacts";

const fallbackThumbnailUrl = "/branding/vwhl-thumbnail.png";

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const useFallback = !artifact.thumbnailUrl || thumbnailFailed;

  return (
    <article className="artifact-card">
      <div className="artifact-preview">
        <Link
          aria-label={`View ${artifact.title} in 3D`}
          className="artifact-preview-link"
          to={`/artifacts/${encodeURIComponent(artifact.id)}`}
        >
          <img
            alt=""
            className={useFallback ? "artifact-preview-fallback" : undefined}
            loading="lazy"
            onError={() => setThumbnailFailed(true)}
            src={useFallback ? fallbackThumbnailUrl : (artifact.thumbnailUrl ?? fallbackThumbnailUrl)}
          />
        </Link>
      </div>
      <div className="artifact-card-body">
        <h2>{artifact.title}</h2>
        <p>{artifact.description}</p>
        <span className={`type-badge ${artifact.type}`}>{artifact.type === "mesh" ? "Mesh" : "Splat"}</span>
      </div>
    </article>
  );
}
