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
  | "manual"
  | "liveApp"
  | "keepLiveApp"
  | "snapshotApp"
  | "appVersions"
  | "downloadApp"
  | "exportProjectArchive"
  | "saveDesignTweaks"
  | "projectValues"
  | "chooseDesign"
  | "acceptedMaterials"
  | "attachMaterials"
  | "removeMaterial"
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
    manual(tenantId, projectId, signal) {
      return request(`${projectPath(tenantId, projectId)}/manual`, signal);
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
    exportProjectArchive(tenantId, projectId, sections, version, signal) {
      const params = new URLSearchParams({
        ...(sections === undefined ? {} : { sections: sections.join(",") }),
        ...(version === undefined ? {} : { version: String(version) }),
      });
      const query = params.size === 0 ? "" : `?${params}`;
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
    projectValues(tenantId, projectId, keys, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/values?${new URLSearchParams({ keys: keys.join(",") })}`,
        signal,
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
    removeMaterial(tenantId, projectId, artifactId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/materials/${encodeURIComponent(artifactId)}`,
        signal,
        null,
        "DELETE",
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
    downloadPackageZip(
      tenantId,
      projectId,
      version,
      signalOrReviewer,
      maybeSignal,
    ) {
      const isSignal =
        signalOrReviewer instanceof AbortSignal ||
        signalOrReviewer === undefined;
      const reviewer = isSignal ? undefined : signalOrReviewer;
      const signal = isSignal ? signalOrReviewer : maybeSignal;
      const params = new URLSearchParams();
      if (reviewer?.roundId !== undefined && reviewer.roundId !== "") {
        params.set("roundId", reviewer.roundId);
      }
      if (reviewer?.reviewerId !== undefined && reviewer.reviewerId !== "") {
        params.set("reviewerId", reviewer.reviewerId);
      }
      if (reviewer?.name !== undefined && reviewer.name !== "") {
        params.set("reviewerName", reviewer.name);
      }
      if (reviewer?.persona !== undefined && reviewer.persona !== "") {
        params.set("persona", reviewer.persona);
      }
      const query = params.size === 0 ? "" : `?${params.toString()}`;
      const slug = (value: string) =>
        value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "package";
      const fallback =
        reviewer?.name !== undefined && reviewer.name.trim() !== ""
          ? `${slug(projectId)}-approval-package-for-${slug(reviewer.name)}-${slug(reviewer.persona ?? "reviewer")}.zip`
          : `package-v${String(version)}.zip`;
      return download(
        `${projectPath(tenantId, projectId)}/packages/${encodeURIComponent(String(version))}/zip${query}`,
        fallback,
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
