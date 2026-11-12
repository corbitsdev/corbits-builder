import { type } from "arktype";
import { NativeSpecialistDeployment } from "./native-specialist.ts";
import { ProjectId } from "./project.ts";
import type { WriterDocumentKind } from "./artifact.ts";
import { WorkflowRole } from "./roles.ts";
export { SpawnedRole, WorkflowRole } from "./roles.ts";

export const INSTALLED_WORKFLOWS_KEY = "sb.installedWorkflows";

// Every workflow package Builder installs, and the role its runs play. A role names the label, model
// and guidance its packages share; a package is what a run is deployed from.
export const WORKFLOW_PACKAGES = {
  coordinator: "coordinator",
  "writer-constraints": "writer",
  "writer-approaches": "writer",
  "writer-product-requirements": "writer",
  "writer-build-plan": "writer",
  "writer-document": "writer",
  reviewer: "reviewer",
  coder: "coder",
  // The coder whose install_packages does not ask, for a project that turned asking off.
  "coder-any-package": "coder",
  designer: "designer",
  presenter: "presenter",
} as const satisfies Record<string, WorkflowRole>;
export type WorkflowPackage = keyof typeof WORKFLOW_PACKAGES;

// Each writer package of a known kind saves only that kind.
export const WRITER_PACKAGES = {
  constraints: "writer-constraints",
  approaches: "writer-approaches",
  product_requirements: "writer-product-requirements",
  build_plan: "writer-build-plan",
} as const satisfies Record<WriterDocumentKind, WorkflowPackage>;
// The writer of any document, which saves it under the kind its task names.
export const DOCUMENT_WRITER_PACKAGE = "writer-document";

const writerDeployments = {
  "writer-constraints": NativeSpecialistDeployment,
  "writer-approaches": NativeSpecialistDeployment,
  "writer-product-requirements": NativeSpecialistDeployment,
  "writer-build-plan": NativeSpecialistDeployment,
  "writer-document": NativeSpecialistDeployment,
} as const satisfies Record<
  (typeof WRITER_PACKAGES)[WriterDocumentKind] | typeof DOCUMENT_WRITER_PACKAGE,
  unknown
>;

export const InstalledWorkflows = type({
  "+": "reject",
  schemaVersion: "2",
  coordinator: NativeSpecialistDeployment,
  ...writerDeployments,
  reviewer: NativeSpecialistDeployment,
  coder: NativeSpecialistDeployment,
  "coder-any-package": NativeSpecialistDeployment,
  designer: NativeSpecialistDeployment,
  presenter: NativeSpecialistDeployment,
});
export type InstalledWorkflows = typeof InstalledWorkflows.infer;

/** Every installed package a run of the role may run on. */
export function roleDeployments(
  installed: InstalledWorkflows,
  role: WorkflowRole,
) {
  return (Object.keys(WORKFLOW_PACKAGES) as WorkflowPackage[])
    .filter((name) => WORKFLOW_PACKAGES[name] === role)
    .map((name) => installed[name]);
}

// Returned only to an authenticated native run. Scope comes from the protected
// coordinator association/native deployment invoker, never a tool argument.
export const WorkflowProjectScope = type({
  "+": "reject",
  tenantId: "string > 0",
  projectId: ProjectId,
  domain: "string > 0",
  role: WorkflowRole,
  workflows: {
    "+": "reject",
    ...writerDeployments,
    // Read only by bundles frozen before writers were split; nothing deploys from it now.
    "writer?": NativeSpecialistDeployment,
    reviewer: NativeSpecialistDeployment,
    coder: NativeSpecialistDeployment,
    designer: NativeSpecialistDeployment,
    "presenter?": NativeSpecialistDeployment,
  },
  // Whether the project's build sandboxes reach any public host rather than only the npm registry.
  openNetwork: "boolean",
  // Where the hub keeps the sandbox child and its runtime; a tool bundle runs
  // out of a package store and cannot resolve them relative to itself.
  build: {
    "+": "reject",
    assetDirectory: "string > 0",
    browserCli: "string > 0",
    childPath: "string > 0",
    dependencyRoots: type("string > 0").array(),
    ripgrepPath: "string > 0",
    runtimeVersion: "string > 0",
  },
});
export type WorkflowProjectScope = typeof WorkflowProjectScope.infer;
