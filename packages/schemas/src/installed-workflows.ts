import { type } from "arktype";
import { NativeSpecialistDeployment } from "./native-specialist.ts";
import { ProjectId } from "./project.ts";
import { WorkflowRole } from "./roles.ts";
export { WorkflowRole } from "./roles.ts";

export const INSTALLED_WORKFLOWS_KEY = "sb.installedWorkflows";

// Each installed workflow package by name, with the role its runs play. Which packages there are
// is the plugins' to declare; a record of an earlier version is installed again.
export const InstalledWorkflows = type({
  "+": "reject",
  schemaVersion: "3",
  packages: {
    "[string]": {
      "+": "reject",
      role: WorkflowRole,
      deployment: NativeSpecialistDeployment,
    },
  },
});
export type InstalledWorkflows = typeof InstalledWorkflows.infer;

/** Every installed package a run of the role may run on. */
export function roleDeployments(
  installed: InstalledWorkflows,
  role: WorkflowRole,
) {
  return Object.values(installed.packages)
    .filter((installedPackage) => installedPackage.role === role)
    .map(({ deployment }) => deployment);
}

// Returned only to an authenticated native run. Scope comes from the protected
// coordinator association/native deployment invoker, never a tool argument.
export const WorkflowProjectScope = type({
  "+": "reject",
  tenantId: "string > 0",
  projectId: ProjectId,
  domain: "string > 0",
  role: WorkflowRole,
  // Every package a run in the project may deploy, by the name it is deployed under.
  workflows: { "[string]": NativeSpecialistDeployment },
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
