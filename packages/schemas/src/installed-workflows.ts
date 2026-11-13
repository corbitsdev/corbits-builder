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

const PortVariable = type(/^[A-Z][A-Z0-9_]*$/);
// A program that keeps running while a project is worked on, as a starter's run and a project's
// stack.run declare it: its command, a line it prints once it is ready, the environment variable
// given the free port it answers on, and any others it needs a free port in, such as an API a dev
// server sends requests on to.
export const AppRun = type({
  "+": "reject",
  command: "string > 0",
  "waitFor?": "string > 0",
  port: PortVariable,
  "extraPorts?": PortVariable.array(),
});
export type AppRun = typeof AppRun.infer;

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
  // How the project's code prepares a fresh workspace, from the starter it began from: the command
  // and what to do when it fails. Code that began from no starter declares nothing.
  "stack?": {
    "+": "reject",
    setup: "string > 0",
    setupFailed: "string > 0",
  },
  // The web app the project serves, from its stack.run: how it starts so a person can open it.
  // A project without one serves nothing.
  "run?": AppRun,
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
