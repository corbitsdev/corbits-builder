import { expect, test } from "bun:test";
import { type } from "arktype";
import {
  WORKFLOW_PACKAGES,
  type InstalledWorkflows,
} from "@corbits-builder/schemas/installed-workflows";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import { scopeWorkflows } from "./project-scope.ts";

const installed = {
  schemaVersion: 2,
  ...Object.fromEntries(
    Object.keys(WORKFLOW_PACKAGES).map((name) => [
      name,
      {
        source: {
          kind: "asset",
          assetId: "asset",
          package: { format: "tarball" },
        },
        entry: "dist/workflow.mjs",
        pin: `@corbits-builder/${name}-native@1.0.0-sha-new`,
        sourceOfferingIds: ["offering"],
        defaultSourceOfferingId: "offering",
      },
    ]),
  ),
} as InstalledWorkflows;

// The scope workflows as a bundle frozen on the last release parses them. A coordinator that could
// not read its scope failed the tool that carried the person's approval and asked for it again.
const ReleasedScopeWorkflows = type({
  "+": "reject",
  writer: NativeSpecialistDeployment,
  reviewer: NativeSpecialistDeployment,
  coder: NativeSpecialistDeployment,
  designer: NativeSpecialistDeployment,
  "presenter?": NativeSpecialistDeployment,
}).onDeepUndeclaredKey("ignore");

test("a run frozen on the last release still reads its scope", () => {
  expect(
    ReleasedScopeWorkflows(scopeWorkflows(installed, false)),
  ).not.toBeInstanceOf(type.errors);
});
