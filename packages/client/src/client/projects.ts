import { type } from "arktype";
import {
  InstalledWorkflows,
  INSTALLED_WORKFLOWS_KEY,
} from "@corbits-builder/schemas/installed-workflows";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import {
  ProjectExport,
  ProjectImportReceipt,
} from "@corbits-builder/schemas/project";
import {
  BindCoordinator,
  CoordinatorBindingReceipt,
} from "@corbits-builder/schemas/coordinator";
import {
  projectPath,
  tenantPath,
  type ClientDeps,
  type ProductApiClient,
} from "./shared";

const Deployment = type({ id: "string > 0", status: "string > 0" });
const TenantConfig = type({ config: { "[string]": "unknown" } });

export function buildProjectsMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "project"
  | "projects"
  | "archiveProject"
  | "restoreProject"
  | "shipProject"
  | "startProjectCoordinator"
  | "projectNextStep"
  | "projectRunStates"
  | "projectAudit"
  | "mutateProject"
  | "versionProject"
  | "exportProject"
  | "importProject"
  | "installedWorkflows"
  | "deployNativeWorkflow"
  | "nativeDeployments"
  | "bindProjectCoordinator"
> {
  const { request } = deps;
  return {
    project(tenantId, projectId, signal) {
      return request(projectPath(tenantId, projectId), signal);
    },
    projects(tenantId, query = {}, signal) {
      const search = new URLSearchParams();
      if (query.status !== undefined) search.set("status", query.status);
      const qs = search.toString();
      return request(
        `${tenantPath(tenantId)}/projects${qs ? `?${qs}` : ""}`,
        signal,
      );
    },
    archiveProject(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/archive`, signal, {});
    },
    restoreProject(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/restore`, signal, {});
    },
    shipProject(tenantId, projectId, shipped, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/${shipped ? "ship" : "unship"}`,
        signal,
        {},
      );
    },
    startProjectCoordinator(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/coordinator`,
        signal,
        {},
      );
    },
    projectNextStep(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/next-step`, signal);
    },
    projectRunStates(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/run-states`, signal);
    },
    projectAudit(tenantId, projectId, query = {}, signal) {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      if (query.before) {
        params.set("beforeTime", query.before.occurredAt);
        params.set("beforeId", query.before.id);
      }
      return request(
        `${projectPath(tenantId, projectId)}/audit?${params}`,
        signal,
      );
    },
    mutateProject(tenantId, projectId, mutation, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/mutations`,
        signal,
        mutation,
      );
    },
    versionProject(tenantId, sourceProjectId, input, signal) {
      return request(
        `${projectPath(tenantId, sourceProjectId)}/mutations`,
        signal,
        {
          mutationId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          command: "version_project",
          payload: { sourceProjectId, title: input.title },
        },
      );
    },
    async exportProject(tenantId, projectId, signal) {
      return ProjectExport.assert(
        await request(`${projectPath(tenantId, projectId)}/export`, signal),
      );
    },
    async importProject(tenantId, file, signal) {
      return ProjectImportReceipt.assert(
        await request(
          `${tenantPath(tenantId)}/projects/import`,
          signal,
          ProjectExport.assert(file),
        ),
      );
    },
    async installedWorkflows(tenantId, signal) {
      const tenant = TenantConfig.assert(
        await request(tenantPath(tenantId), signal),
      );
      return InstalledWorkflows.assert(tenant.config[INSTALLED_WORKFLOWS_KEY]);
    },
    async deployNativeWorkflow(tenantId, input, signal) {
      return Deployment.assert(
        await request(
          `${tenantPath(tenantId)}/workflows/deployments`,
          signal,
          NativeSpecialistDeployment.assert(input),
        ),
      );
    },
    async nativeDeployments(tenantId, signal) {
      return Deployment.array().assert(
        await request(`${tenantPath(tenantId)}/workflows/deployments`, signal),
      );
    },
    async bindProjectCoordinator(tenantId, projectId, input, signal) {
      return CoordinatorBindingReceipt.assert(
        await request(
          `${projectPath(tenantId, projectId)}/coordinator`,
          signal,
          BindCoordinator.assert(input),
        ),
      );
    },
  };
}
