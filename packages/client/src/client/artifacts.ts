import type { MaterialReceipt } from "@corbits-builder/schemas/artifact";
import {
  ProductApiError,
  projectPath,
  type ClientDeps,
  type ProductApiClient,
} from "./shared";

export function buildArtifactsMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "artifact"
  | "projectArtifacts"
  | "projectActivity"
  | "decidedApprovals"
  | "designDraft"
  | "designThemes"
  | "designTheme"
  | "acceptance"
  | "liveApp"
  | "keepLiveApp"
  | "snapshotApp"
  | "appVersions"
  | "downloadApp"
  | "exportProjectArchive"
  | "saveDesignTweaks"
  | "chooseDesign"
  | "acceptedMaterials"
  | "attachMaterials"
  | "downloadPackageZip"
  | "approvalRounds"
  | "startApprovalRound"
  | "recordReviewerDecision"
  | "settleApprovalRound"
  | "triageReviewerFeedback"
> {
  const { request, baseUrl, headers, fetchRequest, options } = deps;
  async function download(
    path: string,
    fallback: string,
    signal?: AbortSignal,
  ) {
    const response = await fetchRequest(
      new Request(new URL(path, baseUrl).href, {
        headers,
        cache: "no-store",
        credentials: options.credentials ?? "same-origin",
        ...(signal ? { signal } : {}),
      }),
    );
    if (!response.ok) throw new ProductApiError(response);
    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const plain = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const filename =
      encoded === undefined ? (plain ?? fallback) : decodeURIComponent(encoded);
    return { filename, archive: await response.blob() };
  }
  return {
    artifact(tenantId, projectId, artifactId, version, signal) {
      const query =
        version === undefined
          ? ""
          : `?${new URLSearchParams({ version: String(version) })}`;
      return request(
        `${projectPath(tenantId, projectId)}/artifacts/${encodeURIComponent(artifactId)}${query}`,
        signal,
      );
    },
    projectArtifacts(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/artifacts`, signal);
    },
    projectActivity(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/activity`, signal);
    },
    decidedApprovals(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/approvals`, signal);
    },
    designDraft(tenantId, projectId, concept, signal) {
      const query =
        concept === undefined ? "" : `?${new URLSearchParams({ concept })}`;
      return request(
        `${projectPath(tenantId, projectId)}/design-draft${query}`,
        signal,
      );
    },
    designThemes(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/design-themes`,
        signal,
      );
    },
    designTheme(tenantId, projectId, themeId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/design-themes/${encodeURIComponent(themeId)}`,
        signal,
      );
    },
    acceptance(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/acceptance`, signal);
    },
    liveApp(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/app`, signal);
    },
    keepLiveApp(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/app/keep-alive`,
        signal,
        {},
      );
    },
    snapshotApp(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/app/snapshot`,
        signal,
        {},
      );
    },
    appVersions(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/app/versions`,
        signal,
      );
    },
    downloadApp(tenantId, projectId, version, signal) {
      const query =
        version === undefined
          ? ""
          : `?${new URLSearchParams({ version: String(version) })}`;
      return download(
        `${projectPath(tenantId, projectId)}/app/archive${query}`,
        "app.zip",
        signal,
      );
    },
    exportProjectArchive(tenantId, projectId, sections, signal) {
      const query =
        sections === undefined
          ? ""
          : `?${new URLSearchParams({ sections: sections.join(",") })}`;
      return download(
        `${projectPath(tenantId, projectId)}/export/archive${query}`,
        "project.zip",
        signal,
      );
    },
    saveDesignTweaks(tenantId, projectId, input, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/design-tweaks`,
        signal,
        input,
      );
    },
    chooseDesign(tenantId, projectId, input, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/design-choice`,
        signal,
        input,
      );
    },
    acceptedMaterials(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/materials/accepted`,
        signal,
      );
    },
    async attachMaterials(tenantId, projectId, files, message, signal) {
      const body = new FormData();
      for (const file of files) body.append("file", file);
      if (message !== undefined) body.append("message", message);
      const response = await fetchRequest(
        new Request(
          new URL(`${projectPath(tenantId, projectId)}/materials`, baseUrl)
            .href,
          {
            method: "POST",
            headers,
            body,
            cache: "no-store",
            credentials: options.credentials ?? "same-origin",
            ...(signal ? { signal } : {}),
          },
        ),
      );
      if (!response.ok) throw new ProductApiError(response);
      return (await response.json()) as MaterialReceipt;
    },
    downloadPackageZip(tenantId, projectId, version, signal) {
      return download(
        `${projectPath(tenantId, projectId)}/packages/${encodeURIComponent(String(version))}/zip`,
        `package-v${String(version)}.zip`,
        signal,
      );
    },
    approvalRounds(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/approval-rounds`,
        signal,
      );
    },
    startApprovalRound(tenantId, projectId, input, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/approval-rounds`,
        signal,
        input,
      );
    },
    recordReviewerDecision(
      tenantId,
      projectId,
      roundId,
      reviewerId,
      input,
      signal,
    ) {
      return request(
        `${projectPath(tenantId, projectId)}/approval-rounds/${encodeURIComponent(roundId)}/reviewers/${encodeURIComponent(reviewerId)}/decision`,
        signal,
        input,
      );
    },
    settleApprovalRound(tenantId, projectId, roundId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/approval-rounds/${encodeURIComponent(roundId)}/settle`,
        signal,
        {},
      );
    },
    triageReviewerFeedback(
      tenantId,
      projectId,
      roundId,
      itemId,
      input,
      signal,
    ) {
      return request(
        `${projectPath(tenantId, projectId)}/approval-rounds/${encodeURIComponent(roundId)}/triage/${encodeURIComponent(itemId)}`,
        signal,
        input,
      );
    },
  };
}
