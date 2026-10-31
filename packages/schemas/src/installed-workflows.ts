import { type } from "arktype";
import { NativeSpecialistDeployment } from "./native-specialist.ts";
import { ProjectId } from "./project.ts";
import { WorkflowRole } from "./roles.ts";
export { SpawnedRole, WorkflowRole } from "./roles.ts";

export const INSTALLED_WORKFLOWS_KEY = "sb.installedWorkflows";
export const InstalledWorkflows = type({
  "+": "reject",
  schemaVersion: "1",
  coordinator: NativeSpecialistDeployment,
  writer: NativeSpecialistDeployment,
  reviewer: NativeSpecialistDeployment,
  coder: NativeSpecialistDeployment,
  // The coder whose install_packages does not ask, for a project that turned asking off.
  coderAnyPackage: NativeSpecialistDeployment,
  designer: NativeSpecialistDeployment,
});
export type InstalledWorkflows = typeof InstalledWorkflows.infer;

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
    writer: NativeSpecialistDeployment,
    reviewer: NativeSpecialistDeployment,
    coder: NativeSpecialistDeployment,
    designer: NativeSpecialistDeployment,
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
