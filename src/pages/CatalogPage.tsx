import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDebounce } from "use-debounce";
import { searchArtifacts, type ArtifactType } from "../api/artifacts";
import { ArtifactFilters } from "../components/catalog/ArtifactFilters";
import { ArtifactGrid } from "../components/catalog/ArtifactGrid";
import { SearchBar } from "../components/catalog/SearchBar";

function parseType(value: string | null): ArtifactType | undefined {
  return value === "mesh" || value === "splat" ? value : undefined;
}

export function CatalogPage() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [query, setQuery] = useState(searchParameters.get("query") ?? "");
  const [debouncedQuery] = useDebounce(query.trim(), 300);
  const type = parseType(searchParameters.get("type"));

  const artifacts = useQuery({
    queryKey: ["artifacts", debouncedQuery, type],
    queryFn: ({ signal }) => searchArtifacts({ query: debouncedQuery || undefined, type }, signal)
  });

  function updateType(nextType?: ArtifactType) {
    setSearchParameters((current) => {
      const next = new URLSearchParams(current);
      if (nextType) next.set("type", nextType);
      else next.delete("type");
      return next;
    });
  }

  return (
    <section className="catalog-page">
      <div className="catalog-hero">
        <div className="page-heading">
          <p className="eyebrow">Cultural heritage collection</p>
          <h1>Explore Digitized Artifacts</h1>
          <p>View meshes and splats in a shared web space.</p>
        </div>
        <SearchBar
          value={query}
          onChange={(value) => {
            setQuery(value);
            setSearchParameters((current) => {
              const next = new URLSearchParams(current);
              if (value.trim()) next.set("query", value);
              else next.delete("query");
              return next;
            });
          }}
        />
      </div>
      <div className="catalog-workspace">
        <div className="catalog-filter-bar">
          <span className="filter-title">Show</span>
          <ArtifactFilters value={type} onChange={updateType} />
        </div>
        <div className="catalog-results">
          <div className="results-heading">
            <h2>Collection objects</h2>
            {artifacts.data && <p aria-live="polite">{artifacts.data.items.length} results</p>}
          </div>
          {artifacts.isPending && <p role="status">Loading artifacts…</p>}
          {artifacts.isError && <p role="alert">The artifact catalog could not be loaded.</p>}
          {artifacts.data && <ArtifactGrid artifacts={artifacts.data.items} />}
        </div>
      </div>
    </section>
  );
}
