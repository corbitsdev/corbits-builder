import { expect, test } from "bun:test";
import { coverArtifact } from "./project-cover.tsx";

const item = (kind: string, artifactId: string) => ({
  artifactId,
  kind,
  title: kind,
  version: 1,
  sha256: "a".repeat(64),
});

test("the chosen design is the cover, else the first concept filed, else none", () => {
  const brief = item("problem_brief", "brief");
  const first = item("design_option", "first");
  const second = item("design_option", "second");
  const chosen = item("design", "chosen");
  expect(coverArtifact([brief, first, second, chosen])?.artifactId).toBe(
    "chosen",
  );
  expect(coverArtifact([brief, first, second])?.artifactId).toBe("first");
  expect(coverArtifact([brief])).toBeNull();
  expect(coverArtifact([])).toBeNull();
});
