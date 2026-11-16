import { expect, test } from "bun:test";
import { type } from "arktype";
import {
  InstalledWorkflows,
  INSTALLED_WORKFLOWS_KEY,
} from "@corbits-builder/schemas/installed-workflows";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import { catalog } from "../plugins/catalog.ts";
import { installedFrom, scopeWorkflows } from "./install-for-tenant.ts";

const deployment = (name: string) => ({
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "dist/workflow.mjs",
  pin: `@corbits-builder/${name}-native@1.0.0-sha-new`,
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
});

const installed = InstalledWorkflows.assert({
  schemaVersion: 3,
  packages: Object.fromEntries(
    Array.from(catalog.packages).map(
      ([
        name,
        {
          declared: { role },
        },
      ]) => [name, { role, deployment: deployment(name) }],
    ),
  ),
});

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
    ReleasedScopeWorkflows(scopeWorkflows(installed, null)),
  ).not.toBeInstanceOf(type.errors);
});

test("a project's coder asks before installing packages unless its person turned asking off", () => {
  expect(scopeWorkflows(installed, null)["coder"]).toEqual(deployment("coder"));
  expect(
    scopeWorkflows(installed, { install_any_package: "yes" })["coder"],
  ).toEqual(deployment("coder-any-package"));
});

test("a stored version 2 record is installed again", () => {
  const stored = Object.fromEntries([
    ["schemaVersion", 2],
    ...Array.from(catalog.packages.keys()).map((name) => [
      name,
      deployment(name),
    ]),
  ]);
  expect(installedFrom({ [INSTALLED_WORKFLOWS_KEY]: stored })).toEqual({
    status: "older",
  });
  expect(installedFrom({ [INSTALLED_WORKFLOWS_KEY]: installed })).toEqual({
    status: "current",
    installed,
  });
});

test("project scope contains exactly the released deployments for either install preference", () => {
  for (const choice of ["no", "yes"]) {
    expect(scopeWorkflows(installed, { install_any_package: choice })).toEqual({
      writer: deployment("writer-constraints"),
      "writer-constraints": deployment("writer-constraints"),
      "writer-approaches": deployment("writer-approaches"),
      "writer-product-requirements": deployment("writer-product-requirements"),
      "writer-build-plan": deployment("writer-build-plan"),
      reviewer: deployment("reviewer"),
      designer: deployment("designer"),
      presenter: deployment("presenter"),
      coder: deployment(choice === "yes" ? "coder-any-package" : "coder"),
    });
  }
});

test("installed records distinguish absence, older versions and malformed data", () => {
  expect(installedFrom(null)).toEqual({ status: "missing" });
  expect(
    installedFrom({ [INSTALLED_WORKFLOWS_KEY]: { schemaVersion: 2 } }),
  ).toEqual({ status: "older" });
  expect(
    installedFrom({ [INSTALLED_WORKFLOWS_KEY]: { schemaVersion: 3 } }),
  ).toEqual({ status: "malformed" });
});
