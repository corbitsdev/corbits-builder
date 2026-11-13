import { type } from "arktype";
import { NativeSpecialistDeployment } from "./native-specialist.ts";
import { ProjectId } from "./project.ts";
import { WorkflowRole } from "./roles.ts";
export { SpawnedRole, WorkflowRole } from "./roles.ts";

export const INSTALLED_WORKFLOWS_KEY = "sb.installedWorkflows";

// Each installed workflow package by name, the coordinator's among them. Which packages there are,
// and the role each plays, comes from the hub's coordinator and the plugins it loads.
export const InstalledWorkflows = type({
  "+": "reject",
  schemaVersion: "3",
  packages: { "[string]": NativeSpecialistDeployment },
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
  // Every installed package a run in the project may deploy, by name.
  workflows: { "[string]": NativeSpecialistDeployment },
  // Whether the project's build sandboxes reach any public host rather than only the npm registry.
  openNetwork: "boolean",
  // What the project's code declares of itself, from the starter it began from: the command that
  // prepares a fresh workspace, what to do when it fails, and whether it serves a web app. Code
  // that began from no starter declares nothing.
  "stack?": {
    "+": "reject",
    setup: "string > 0",
    setupFailed: "string > 0",
    serves: "boolean",
  },
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
