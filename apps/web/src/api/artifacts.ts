import {
  ProductApiError,
  type PackageZipReviewerQuery,
} from "@corbits-builder/client";
import type {
  DesignTweaks,
  UserManual,
} from "@corbits-builder/schemas/artifact";
import type {
  RecordReviewerDecision,
  StartApprovalRound,
  TriageDecisionInput,
} from "@corbits-builder/schemas/approval-round";
import { productClient, refusalBody } from "./transport.ts";
import { workspaceTenantId } from "./auth.ts";
import { ApiFailure } from "./types.ts";
import { wording } from "../config.ts";

const versionText = wording.appVersion;

export async function listProjectArtifacts(projectId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().projectArtifacts(tenantId, projectId);
}

export async function readProjectPlan(projectId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().projectPlan(tenantId, projectId);
}

export async function readArtifact(
  projectId: string,
  artifactId: string,
  version?: number,
) {
  const tenantId = await workspaceTenantId();
  return productClient().artifact(tenantId, projectId, artifactId, version);
}

async function nullWhenMissing<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (cause) {
    if (cause instanceof ProductApiError && cause.response.status === 404)
      return null;
    throw cause;
  }
}

/** The live coder's acceptance checklist as it ticks items, or null until it has written one. */
export async function readAcceptance(projectId: string, signal?: AbortSignal) {
  const tenantId = await workspaceTenantId();
  const read = await nullWhenMissing(
    productClient().acceptance(tenantId, projectId, signal),
  );
  return read?.markdown ?? null;
}

/** The app's user manual with its pictures, or null until the coder has written one. */
export async function readUserManual(
  projectId: string,
  signal?: AbortSignal,
): Promise<UserManual | null> {
  const tenantId = await workspaceTenantId();
  return nullWhenMissing(productClient().manual(tenantId, projectId, signal));
}

/** The project's app as the person can open it: running at its own origin, starting, or why not. */
export async function readLiveApp(projectId: string, signal?: AbortSignal) {
  const tenantId = await workspaceTenantId();
  try {
    return await productClient().liveApp(tenantId, projectId, signal);
  } catch (cause) {
    throw await readableFailure(cause);
  }
}

/** Tells the hub the project is open, so it runs the project's app; returns the app's state. */
export async function keepLiveApp(projectId: string, signal?: AbortSignal) {
  const tenantId = await workspaceTenantId();
  return productClient().keepLiveApp(tenantId, projectId, signal);
}

/** A hub refusal's status, code and body, whatever the body holds; undefined for other failures. */
async function refusal(cause: unknown) {
  if (!(cause instanceof ProductApiError)) return undefined;
  const body = await refusalBody(cause);
  const record = (
    body !== null && typeof body === "object" ? body : {}
  ) as Record<string, unknown>;
  const code =
    typeof record["code"] === "string" ? record["code"] : "no readable code";
  return { status: cause.response.status, code, body: record };
}

/** Any failure as one a person can read: the hub's status and code, never a parser's message. */
export async function readableFailure(cause: unknown): Promise<unknown> {
  if (cause instanceof ApiFailure) return cause;
  const failure = await refusal(cause);
  if (failure)
    return new ApiFailure(
      {
        code: failure.code,
        message:
          versionText.refusals[failure.code] ??
          versionText.refused(failure.status, failure.code),
        correlationId: "-",
        retryable: false,
      },
      failure.status,
    );
  if (cause instanceof SyntaxError)
    return new ApiFailure({
      code: "unreadable_response",
      message: versionText.unreadable,
      correlationId: "-",
      retryable: false,
    });
  return cause;
}

/** Every filed app version, newest first, and whether this viewer can snapshot the code now. */
export async function listAppVersions(projectId: string, signal?: AbortSignal) {
  const tenantId = await workspaceTenantId();
  return productClient().appVersions(tenantId, projectId, signal);
}

/**
 * The app version a download or export carries, with a note saying which it is and whether it is
 * current. While the newest coder run's workspace is on disk, a viewer who can manage the project
 * files it first, so it carries the code whether or not a check passed. With no coder run, or no
 * app in its workspace on disk, there is nothing to file and the hub serves the saved app, which is
 * current. A viewer who cannot manage the project, a workspace on another machine, or a snapshot
 * that fails leaves the saved app, labelled as not current.
 */
export async function currentAppVersion(
  projectId: string,
): Promise<{ version?: number; note: string; current: boolean }> {
  const { snapshot } = await listAppVersions(projectId);
  if (!snapshot.ready) {
    if (snapshot.code === "forbidden")
      return { note: versionText.forbidden, current: false };
    if (snapshot.reason === "not_on_local_sidecar")
      return { note: versionText.elsewhere, current: false };
    return { note: versionText.saved, current: true };
  }
  const tenantId = await workspaceTenantId();
  try {
    const { artifact } = await productClient().snapshotApp(tenantId, projectId);
    return {
      version: artifact.version,
      note: versionText.current(artifact.version),
      current: true,
    };
  } catch (cause) {
    const failure = await refusal(cause);
    if (!failure) throw cause;
    return {
      note: versionText.failed(failure.status, failure.code),
      current: false,
    };
  }
}

/** The app version currentAppVersion names, as a zip, with its note and whether it is current. */
export async function downloadApp(projectId: string) {
  try {
    const { version, note, current } = await currentAppVersion(projectId);
    const tenantId = await workspaceTenantId();
    return {
      ...(await productClient().downloadApp(tenantId, projectId, version)),
      note,
      current,
    };
  } catch (cause) {
    throw await readableFailure(cause);
  }
}

/** The live designer's unfiled mockup files, or null when no designer is writing one. */
export async function readDesignDraft(projectId: string, concept?: string) {
  const tenantId = await workspaceTenantId();
  const draft = await nullWhenMissing(
    productClient().designDraft(tenantId, projectId, concept),
  );
  return draft?.files ?? null;
}

export async function saveDesignTweaks(projectId: string, input: DesignTweaks) {
  const tenantId = await workspaceTenantId();
  return productClient().saveDesignTweaks(tenantId, projectId, input);
}

/** The named project values as stored, null where the project has none yet. */
export async function readProjectValues(
  projectId: string,
  keys: readonly string[],
  signal: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  const read = await productClient().projectValues(
    tenantId,
    projectId,
    keys,
    signal,
  );
  return read.values;
}

/** Every declared project value as stored, with what each holds and the types it takes. */
export async function readDeclaredProjectValues(
  projectId: string,
  signal: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  return productClient().declaredProjectValues(tenantId, projectId, signal);
}

/** Saves one project value as the person; the hub checks it against its declared type. */
export async function saveProjectValue(
  projectId: string,
  name: string,
  value: unknown,
) {
  const tenantId = await workspaceTenantId();
  return productClient().saveProjectValues(tenantId, projectId, {
    [name]: value,
  });
}

/** The person approves a filed document at the version they read. */
export async function approveDocument(
  projectId: string,
  artifactId: string,
  version: number,
) {
  const tenantId = await workspaceTenantId();
  return productClient().approveDocument(
    tenantId,
    projectId,
    artifactId,
    version,
  );
}

/** The file types the coordinator reads and how many and how large they may be. */
export async function acceptedMaterials(projectId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().acceptedMaterials(tenantId, projectId);
}

/** Files each file as a material and mails them to the coordinator with the message. */
export async function attachMaterials(
  projectId: string,
  files: readonly File[],
  message?: string,
) {
  const tenantId = await workspaceTenantId();
  return productClient().attachMaterials(tenantId, projectId, files, message);
}

/** Takes an attached file back; the coordinator is told and the file leaves the documents. */
export async function removeMaterial(projectId: string, artifactId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().removeMaterial(tenantId, projectId, artifactId);
}

export async function downloadPackageZip(
  projectId: string,
  version: number,
  signalOrReviewer?: AbortSignal | PackageZipReviewerQuery,
  signal?: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  return productClient().downloadPackageZip(
    tenantId,
    projectId,
    version,
    signalOrReviewer,
    signal,
  );
}

export async function downloadApprovalPackageZip(
  projectId: string,
  version: number,
  reviewer?: {
    name: string;
    persona: string;
    reviewerId?: string;
    roundId?: string;
  },
  signal?: AbortSignal,
): Promise<File> {
  const { filename, archive } = await downloadPackageZip(
    projectId,
    version,
    reviewer,
    signal,
  );
  return new File([archive], filename, { type: "application/zip" });
}

export async function listApprovalRounds(
  projectId: string,
  signal?: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  return productClient().approvalRounds(tenantId, projectId, signal);
}

export async function startApprovalRound(
  projectId: string,
  input: StartApprovalRound,
) {
  const tenantId = await workspaceTenantId();
  return productClient().startApprovalRound(tenantId, projectId, input);
}

export async function recordReviewerDecision(
  projectId: string,
  roundId: string,
  reviewerId: string,
  input: RecordReviewerDecision,
) {
  const tenantId = await workspaceTenantId();
  return productClient().recordReviewerDecision(
    tenantId,
    projectId,
    roundId,
    reviewerId,
    input,
  );
}

export async function settleApprovalRound(projectId: string, roundId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().settleApprovalRound(tenantId, projectId, roundId);
}

export async function triageReviewerFeedback(
  projectId: string,
  roundId: string,
  itemId: string,
  input: TriageDecisionInput,
) {
  const tenantId = await workspaceTenantId();
  return productClient().triageReviewerFeedback(
    tenantId,
    projectId,
    roundId,
    itemId,
    input,
  );
}
