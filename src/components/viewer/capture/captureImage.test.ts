import { describe, expect, it } from "vitest";
import { captureFilename } from "./captureImage";

describe("captureFilename", () => {
  it("keeps a readable name and adds PNG", () => expect(captureFilename(" Statue front ")).toBe("Statue front.png"));
  it("removes path and control characters", () => expect(captureFilename("a/b\\c:\u0001*? ")).toBe("a-b-c----.png"));
  it("provides a fallback", () => expect(captureFilename(" ... ")).toBe("capture.png"));
});
