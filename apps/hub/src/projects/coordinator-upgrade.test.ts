import { expect, test } from "bun:test";
import type { InstalledWorkflows } from "@corbits-builder/schemas/installed-workflows";
import { staleRuns } from "./coordinator-upgrade.ts";

const deployment = (pin: string) => ({
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "dist/workflow.mjs",
  pin,
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
});
const installed: InstalledWorkflows = {
  schemaVersion: 1,
  coordinator: deployment("@corbits-builder/coordinator-native@1.0.0-sha-new"),
  writers: {
    constraints: deployment(
      "@corbits-builder/writer-constraints-native@1.0.0-sha-new",
    ),
    approaches: deployment(
      "@corbits-builder/writer-approaches-native@1.0.0-sha-new",
    ),
    product_requirements: deployment(
      "@corbits-builder/writer-product-requirements-native@1.0.0-sha-new",
    ),
    build_plan: deployment(
      "@corbits-builder/writer-build-plan-native@1.0.0-sha-new",
    ),
  },
  reviewer: deployment("@corbits-builder/reviewer-native@1.0.0-sha-new"),
  coder: deployment("@corbits-builder/coder-native@1.0.0-sha-new"),
  coderAnyPackage: deployment("@corbits-builder/coder-native@1.0.0-sha-any"),
  designer: deployment("@corbits-builder/designer-native@1.0.0-sha-new"),
  presenter: deployment("@corbits-builder/presenter-native@1.0.0-sha-new"),
};
const frozen = (name: string, version: string) => ({
  closure: { topLevel: [{ name, version }] },
});

test("a run is stale when its frozen pin is not one installed for its role", () => {
  const runs = [
    {
      runId: "old-coder",
      role: "coder" as const,
      bundle: frozen("@corbits-builder/coder-native", "1.0.0-sha-old"),
    },
    {
      runId: "coder",
      role: "coder" as const,
      bundle: frozen("@corbits-builder/coder-native", "1.0.0-sha-new"),
    },
    {
      runId: "any-coder",
      role: "coder" as const,
      bundle: frozen("@corbits-builder/coder-native", "1.0.0-sha-any"),
    },
    {
      runId: "designer",
      role: "designer" as const,
      bundle: frozen("@corbits-builder/designer-native", "1.0.0-sha-new"),
    },
    {
      runId: "old-designer",
      role: "designer" as const,
      bundle: frozen("@corbits-builder/designer-native", "1.0.0-sha-old"),
    },
    {
      runId: "approaches-writer",
      role: "writer" as const,
      bundle: frozen(
        "@corbits-builder/writer-approaches-native",
        "1.0.0-sha-new",
      ),
    },
    {
      runId: "single-writer",
      role: "writer" as const,
      bundle: frozen("@corbits-builder/writer-native", "1.0.0-sha-old"),
    },
    { runId: "unreadable", role: "writer" as const, bundle: {} },
  ];
  expect(staleRuns(runs, installed).map((run) => run.runId)).toEqual([
    "old-coder",
    "old-designer",
    "single-writer",
    "unreadable",
  ]);
});
