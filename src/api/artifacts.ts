import { z } from "zod";
import { ApiClient } from "./apiClient";
import { browserSessionAuthClient } from "../auth/AuthClient";

const artifactTypeSchema = z.enum(["mesh", "splat"]);

export const artifactSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  type: artifactTypeSchema,
  thumbnailUrl: z.string().min(1).nullable(),
  contentUrl: z.string().min(1),
  sizeBytes: z.number().int().nonnegative()
});

const artifactPageSchema = z.object({
  items: z.array(artifactSchema),
  nextCursor: z.string().nullable()
});

export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

const apiClient = new ApiClient(browserSessionAuthClient);

export interface ArtifactSearch {
  query?: string;
  type?: ArtifactType;
  cursor?: string;
  limit?: number;
}

export async function searchArtifacts(search: ArtifactSearch, signal?: AbortSignal) {
  const parameters = new URLSearchParams();
  if (search.query) parameters.set("query", search.query);
  if (search.type) parameters.set("type", search.type);
  if (search.cursor) parameters.set("cursor", search.cursor);
  parameters.set("limit", String(search.limit ?? 24));

  const payload = await apiClient.get(`/artifacts?${parameters.toString()}`, signal);
  return artifactPageSchema.parse(payload);
}

export async function getArtifact(id: string, signal?: AbortSignal) {
  const payload = await apiClient.get(`/artifacts/${encodeURIComponent(id)}`, signal);
  return artifactSchema.parse(payload);
}
