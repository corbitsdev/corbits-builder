import { expect, test } from "bun:test";
import type { ProjectArtifact } from "@corbits-builder/client";
import { wording } from "../../../config.ts";
import { reviewApproval } from "./design-concept.ts";

const filed = (
  kind: string,
  version: number,
  approvedVersion?: number,
): ProjectArtifact => ({
  artifactId: `${kind}-1`,
  kind,
  title: "Calm",
  version,
  sha256: "a".repeat(64),
  filedAt: "2026-11-20T10:00:00.000Z",
  ...(approvedVersion === undefined ? {} : { approvedVersion }),
});

test("only a concept's option is approved on a review screen", () => {
  expect(reviewApproval(filed("design_option", 1))).toEqual({
    option: "design_option-1",
  });
});

test("the filed design says why it is not approved there: approved already, or no option to choose", () => {
  expect(reviewApproval(filed("design", 2, 2))).toEqual({
    unavailable: wording.designReview.approved,
  });
  expect(reviewApproval(filed("design", 3, 2))).toEqual({
    unavailable: wording.designReview.noOption,
  });
});
