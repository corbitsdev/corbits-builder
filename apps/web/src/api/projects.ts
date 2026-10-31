/**
 * Projects: receipt-scoped mutations, listed, read and forked through the
 * typed client. Fields the hub does not record carry their empty value (see
 * `types.ts`).
 */
import { productClient } from "./transport.ts";
import { ApiFailure, type ProjectSummary } from "./types.ts";
import { workspaceTenantId } from "./auth.ts";
import {
  currentAppVersion,
  listAppVersions,
  readableFailure,
} from "./artifacts.ts";
import { ProductApiError } from "@corbits-builder/client";
import {
  type ExportSection,
  exportSection,
  ProjectExport,
  type ProjectSummary as ProjectSummaryRow,
} from "@corbits-builder/schemas/project";
import {
  readProjectImport,
  type ProjectImport,
} from "@corbits-builder/schemas/project-import";
import { type } from "arktype";
import JSZip from "jszip";
import { wording } from "../config.ts";

/**
 * The project id is client-minted (`ProjectId`: alphanumeric, `-`/`_`,
 * <= 128), so creation names one up front rather than letting the hub mint
 * it. A short random slug satisfies the pattern without reading like a
 * title, which the mutation carries separately.
 */
function newProjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "sb-";
  for (const byte of bytes) out += alphabet[byte % alphabet.length]!;
  return out;
}

const TITLE_MAX = 2000;

/**
 * Creates the project with one `create_project` mutation. The hub deploys and
 * attaches the coordinator, then mails it `problemStatement` as the first chat
 * message, before this returns.
 */
export async function createProject(payload: {
  title?: string;
  problemStatement?: string;
  profile?: string;
}): Promise<{ projectId: string }> {
  const title = (
    payload.title?.trim() ||
    payload.problemStatement?.trim().split("\n")[0]?.trim() ||
    ""
  ).slice(0, TITLE_MAX);
  if (title.length === 0) {
    throw new ApiFailure({
      code: "validation_failed",
      message: wording.newProject.titleRequired,
      correlationId: "-",
      retryable: false,
    });
  }
  const client = productClient();
  const tenantId = await workspaceTenantId();
  const projectId = newProjectId();
  try {
    await client.mutateProject(tenantId, projectId, {
      mutationId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      command: "create_project",
      payload: {
        title,
        ...(payload.profile === undefined ? {} : { profile: payload.profile }),
        ...(payload.problemStatement?.trim()
          ? { problemStatement: payload.problemStatement.trim() }
          : {}),
      },
    });
  } catch (cause) {
    throw await creationFailure(cause);
  }
  return { projectId };
}

/** The hub's refusal to create a project, with its code and message when it gave them. */
async function creationFailure(cause: unknown): Promise<unknown> {
  if (!(cause instanceof ProductApiError)) return cause;
  const body: unknown = await cause.response
    .clone()
    .json()
    .catch(() => undefined);
  const record = body !== null && typeof body === "object" ? body : {};
  const code =
    "code" in record && typeof record.code === "string"
      ? record.code
      : "project_create_failed";
  const message =
    "message" in record &&
    typeof record.message === "string" &&
    record.message.length > 0
      ? record.message
      : wording.newProject.createFailed;
  return new ApiFailure(
    { code, message, correlationId: "-", retryable: false },
    cause.response.status,
  );
}

/** The project read, verbatim: title and lifecycle. */
export async function getProject(projectId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().project(tenantId, projectId);
}

function summaryOf(row: ProjectSummaryRow): ProjectSummary {
  return {
    id: row.projectId,
    title: row.title,
    stage: row.stage,
    shippedAt: row.shippedAt,
    archivedAt: row.status === "archived" ? row.updatedAt : null,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
  };
}

export async function listProjects(
  status?: "active" | "archived" | "all",
): Promise<ProjectSummary[]> {
  const tenantId = await workspaceTenantId();
  const page = await productClient().projects(tenantId, {
    status: status ?? "active",
  });
  return page.projects.map(summaryOf);
}

export async function archiveProject(projectId: string): Promise<void> {
  const tenantId = await workspaceTenantId();
  await productClient().archiveProject(tenantId, projectId);
}

export async function restoreProject(projectId: string): Promise<void> {
  const tenantId = await workspaceTenantId();
  await productClient().restoreProject(tenantId, projectId);
}

/** Sets or clears the person's shipped mark; the project stays active either way. */
export async function shipProject(
  projectId: string,
  shipped: boolean,
): Promise<void> {
  const tenantId = await workspaceTenantId();
  await productClient().shipProject(tenantId, projectId, shipped);
}

export async function startProjectCoordinator(
  projectId: string,
): Promise<void> {
  const tenantId = await workspaceTenantId();
  await productClient().startProjectCoordinator(tenantId, projectId);
}

/** Renames through a `rename_project` mutation. */
export async function renameProject(
  projectId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new ApiFailure({
      code: "validation_failed",
      message: wording.library.nameRequired,
      correlationId: "-",
      retryable: false,
    });
  }
  const client = productClient();
  const tenantId = await workspaceTenantId();
  await client.mutateProject(tenantId, projectId, {
    mutationId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    command: "rename_project",
    payload: { title: trimmed },
  });
}

/** Versions a project (a fork of its current state). */
export async function versionProject(
  projectId: string,
  title: string,
): Promise<{ projectId: string }> {
  const client = productClient();
  const tenantId = await workspaceTenantId();
  const receipt = await client.versionProject(tenantId, projectId, {
    title: title.trim() || (await client.project(tenantId, projectId)).title,
  });
  return { projectId: receipt.projectId };
}

/** The project as a zip of the given sections (all when absent), always with project.json. */
export async function exportProject(
  projectId: string,
  sections?: readonly ExportSection[],
) {
  try {
    const app =
      sections === undefined || sections.includes("build")
        ? await currentAppVersion(projectId)
        : undefined;
    const tenantId = await workspaceTenantId();
    return {
      ...(await productClient().exportProjectArchive(
        tenantId,
        projectId,
        sections,
      )),
      ...(app ? { note: app.note } : {}),
    };
  } catch (cause) {
    throw await readableFailure(cause);
  }
}

/** The export sections the project has anything filed for. */
export async function exportSections(
  projectId: string,
): Promise<Set<ExportSection>> {
  // A coder workspace with nothing filed yet still offers its build; only the export files it.
  try {
    const app = await listAppVersions(projectId);
    const tenantId = await workspaceTenantId();
    const { artifacts } = await productClient().projectArtifacts(
      tenantId,
      projectId,
    );
    const sections = new Set(artifacts.map(({ kind }) => exportSection(kind)));
    if (app.snapshot.ready) sections.add("build");
    return sections;
  } catch (cause) {
    throw await readableFailure(cause);
  }
}

const invalidImport = () =>
  new ApiFailure({
    code: "invalid_project_import",
    message: wording.importProject.invalid,
    correlationId: "-",
    retryable: false,
  });

const startsWithZipSignature = (bytes: Uint8Array) =>
  bytes[0] === 0x50 && bytes[1] === 0x4b;

async function projectJsonOf(archive: Uint8Array): Promise<string> {
  const entry = (await JSZip.loadAsync(archive)).file("project.json");
  if (entry === null) throw invalidImport();
  return entry.async("string");
}

/** The project.json of an export's zip, or the file itself when it is that JSON. */
async function importJson(file: Blob): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return JSON.parse(
      startsWithZipSignature(bytes)
        ? await projectJsonOf(bytes)
        : new TextDecoder().decode(bytes),
    );
  } catch {
    throw invalidImport();
  }
}

/** An exported file from this app or the original Solution Builder, in this app's format. */
export async function readImportFile(file: Blob): Promise<ProjectImport> {
  const read = readProjectImport(await importJson(file));
  if (read instanceof type.errors) throw invalidImport();
  return read;
}

/** Starts a new project from an exported file; the hub files its documents first. */
export async function importProject(
  file: unknown,
): Promise<{ projectId: string }> {
  const parsed = ProjectExport(file);
  if (parsed instanceof type.errors) throw invalidImport();
  const tenantId = await workspaceTenantId();
  try {
    return await productClient().importProject(tenantId, parsed);
  } catch (cause) {
    throw await creationFailure(cause);
  }
}
