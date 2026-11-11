import {
  ProjectExport,
  ProjectImportReceipt,
} from "@corbits-builder/schemas/project";
import {
  projectPath,
  tenantPath,
  type ClientDeps,
  type ProductApiClient,
} from "./shared";

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
  | "mutateProject"
  | "versionProject"
  | "exportProject"
  | "importProject"
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
  };
}
