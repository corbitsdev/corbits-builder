import { ProductApiError } from "@corbits-builder/client";
import type {
  DesignChoice,
  DesignTweaks,
} from "@corbits-builder/schemas/artifact";
import { productClient } from "./transport.ts";
import { workspaceTenantId } from "./auth.ts";
import { ApiFailure } from "./types.ts";
import { wording } from "../config.ts";

const versionText = wording.appVersion;

export async function listProjectArtifacts(projectId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().projectArtifacts(tenantId, projectId);
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

/** The project's app as the person can open it: running at its own origin, starting, or why not. */
export async function readLiveApp(projectId: string, signal?: AbortSignal) {
  const tenantId = await workspaceTenantId();
  return productClient().liveApp(tenantId, projectId, signal);
}

/** Tells the hub the project is open, so it runs the project's app; returns the app's state. */
export async function keepLiveApp(projectId: string, signal?: AbortSignal) {
  const tenantId = await workspaceTenantId();
  return productClient().keepLiveApp(tenantId, projectId, signal);
}

/** A hub refusal's status, code and body, whatever the body holds; undefined for other failures. */
async function refusal(cause: unknown) {
  if (!(cause instanceof ProductApiError)) return undefined;
  const body: unknown = await cause.response
    .clone()
    .json()
    .catch(() => undefined);
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
        message: versionText.refused(failure.status, failure.code),
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
 * The app version a download or export carries, with a note saying which it is and why. A viewer
 * who can manage the project files the newest coder workspace first, so it carries the current code
 * whether or not a check passed; anyone else, or a snapshot that cannot be made, gets the latest
 * saved version, labelled as such, and current says which. No version at all leaves only the note.
 */
export async function currentAppVersion(
  projectId: string,
): Promise<{ version?: number; note: string; current: boolean }> {
  const tenantId = await workspaceTenantId();
  const { versions, snapshot } = await listAppVersions(projectId);
  let why: string;
  if (snapshot.ready) {
    try {
      const { artifact } = await productClient().snapshotApp(
        tenantId,
        projectId,
      );
      return {
        version: artifact.version,
        note: versionText.current(artifact.version),
        current: true,
      };
    } catch (cause) {
      const failure = await refusal(cause);
      if (!failure) throw cause;
      why =
        failure.code === "app_too_large"
          ? versionText.why.tooLarge(
              Number(failure.body["bytes"]),
              Number(failure.body["limit"]),
            )
          : versionText.why.failed(failure.status, failure.code);
    }
  } else why = versionText.why[snapshot.code];
  const latest = versions[0];
  if (!latest) return { note: versionText.none(why), current: false };
  return {
    version: latest.version,
    note: versionText.saved(latest.version, latest.source, why),
    current: false,
  };
}

/** The app version currentAppVersion names, as a zip, with its note and whether it is current. */
export async function downloadApp(projectId: string) {
  try {
    const { version, note, current } = await currentAppVersion(projectId);
    const tenantId = await workspaceTenantId();
    // With nothing filed, the hub serves the app repository's latest saved work, or refuses.
    if (version === undefined)
      return {
        ...(await productClient().downloadApp(tenantId, projectId, undefined)),
        note: versionText.savedWork,
        current: true,
      };
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

export async function chooseDesign(projectId: string, input: DesignChoice) {
  const tenantId = await workspaceTenantId();
  return productClient().chooseDesign(tenantId, projectId, input);
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
