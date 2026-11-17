import { expect, test } from "bun:test";
import {
  InstalledWorkflows,
  INSTALLED_WORKFLOWS_KEY,
} from "@corbits-builder/schemas/installed-workflows";
import { installedFrom } from "./install-for-tenant.ts";

const deployment = {
  source: {
    kind: "asset",
    assetId: "asset",
    package: { format: "tarball" },
  },
  entry: "dist/workflow.mjs",
  pin: "@corbits-builder/coder-native@1.0.0",
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
};

test("a stored record tells missing, older and malformed apart from current", () => {
  const current = InstalledWorkflows.assert({
    schemaVersion: 3,
    packages: { coder: deployment },
  });
  expect(installedFrom(null)).toEqual({ status: "missing" });
  expect(installedFrom({})).toEqual({ status: "missing" });
  expect(
    installedFrom({ [INSTALLED_WORKFLOWS_KEY]: { schemaVersion: 2 } }),
  ).toEqual({ status: "older" });
  expect(installedFrom([])).toEqual({ status: "malformed" });
  expect(
    installedFrom({
      [INSTALLED_WORKFLOWS_KEY]: {
        schemaVersion: 3,
        packages: { coder: { role: "coder", deployment } },
      },
    }),
  ).toEqual({ status: "malformed" });
  expect(installedFrom({ [INSTALLED_WORKFLOWS_KEY]: current })).toEqual({
    status: "current",
    installed: current,
  });
});
