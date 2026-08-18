import { describe, expect, it } from "vitest";
import { artifactSchema } from "./artifacts";

describe("artifact API contract", () => {
  it("rejects an invalid artifact type returned by the server", () => {
    const result = artifactSchema.safeParse({
      id: "artifact-1",
      title: "Test artifact",
      description: "",
      type: "point-cloud",
      thumbnailUrl: "/files/artifact-1/thumbnail",
      contentUrl: "/files/artifact-1/content",
      sizeBytes: 10
    });

    expect(result.success).toBe(false);
  });
});
