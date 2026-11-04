import { type } from "arktype";
import { NativeSpecialistDeployment } from "./native-specialist.ts";
import { ProjectId } from "./project.ts";
import { WorkflowRole } from "./roles.ts";
export { SpawnedRole, WorkflowRole } from "./roles.ts";

export const INSTALLED_WORKFLOWS_KEY = "sb.installedWorkflows";
// One writer package per document kind, each saving only its kind.
const WriterDeployments = type({
  "+": "reject",
  constraints: NativeSpecialistDeployment,
  approaches: NativeSpecialistDeployment,
  product_requirements: NativeSpecialistDeployment,
  build_plan: NativeSpecialistDeployment,
});
export const InstalledWorkflows = type({
  "+": "reject",
  schemaVersion: "1",
  coordinator: NativeSpecialistDeployment,
  writers: WriterDeployments,
  reviewer: NativeSpecialistDeployment,
  coder: NativeSpecialistDeployment,
  // The coder whose install_packages does not ask, for a project that turned asking off.
  coderAnyPackage: NativeSpecialistDeployment,
  designer: NativeSpecialistDeployment,
  presenter: NativeSpecialistDeployment,
});
export type InstalledWorkflows = typeof InstalledWorkflows.infer;

// Every installed package a run of each role may run on.
const DEPLOYMENTS_BY_ROLE: Record<
  WorkflowRole,
  (installed: InstalledWorkflows) => NativeSpecialistDeployment[]
> = {
  coordinator: (installed) => [installed.coordinator],
  writer: (installed) => Object.values(installed.writers),
  reviewer: (installed) => [installed.reviewer],
  coder: (installed) => [installed.coder, installed.coderAnyPackage],
  designer: (installed) => [installed.designer],
  presenter: (installed) => [installed.presenter],
};

export function roleDeployments(
  installed: InstalledWorkflows,
  role: WorkflowRole,
) {
  return DEPLOYMENTS_BY_ROLE[role](installed);
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
    writers: WriterDeployments,
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
