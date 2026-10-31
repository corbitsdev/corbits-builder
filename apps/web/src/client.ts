/**
 * The API client the screens call.
 *
 * The exported `api` object exposes the hub's operations. Packages are
 * installed before project execution; the UI renders product facts and uses
 * native deployment rather than assembling workflow source.
 *
 *  - `createProject` sends the opening problem as the first chat message, not
 *    an artifact. Creating the project is one hub call: the hub deploys and
 *    attaches the coordinator and mails it the opening problem before that
 *    call returns.
 *  - `deleteProject` archives; the hub has soft archive/restore only.
 *  - `decide` resolves a native approval.
 */
import type { ExportSection } from "@corbits-builder/schemas/project";
import { singleFlight } from "./single-flight.ts";
import { listCredentials as apiListCredentials } from "./api/credentials.ts";
import {
  archiveProject as apiArchiveProject,
  createProject as apiCreateProject,
  exportProject as apiExportProject,
  exportSections as apiExportSections,
  getProject as apiGetProject,
  importProject as apiImportProject,
  readImportFile as apiReadImportFile,
  renameProject as apiRenameProject,
  restoreProject as apiRestoreProject,
  shipProject as apiShipProject,
  listProjects as apiListProjects,
} from "./api/projects.ts";
import {
  latestQuestion as apiLatestQuestion,
  readConversationEvents,
  sendMessage as apiSendMessage,
} from "./api/conversation.ts";
import { decideApproval } from "./api/decisions.ts";
import { ApiFailure, type ConversationEvent } from "./api/types.ts";

export { ApiFailure, type ProjectSummary } from "./api/types.ts";

export const api = {
  // --- Credentials: the bring-your-own-key path. ---------------------------
  providers: async () => ({ providers: await apiListCredentials() }),

  // --- Decisions ----------------------------------------------------------
  /**
   * Decides one wait. A native approval (`decision.approvalId`) is resolved
   * through the hub's decide endpoint; a workflow question is answered in the
   * conversation.
   */
  decide: async (
    projectId: string,
    decision: Record<string, unknown>,
  ): Promise<{ ok: true }> => {
    const approvalId = decision["approvalId"];
    if (typeof approvalId !== "string" || approvalId.length === 0) {
      throw new ApiFailure({
        code: "native_approval_required",
        message:
          "A native approvalId is required. Answer workflow questions in the conversation.",
        correlationId: "-",
        retryable: false,
      });
    }
    const choice =
      decision["decision"] === "reject" || decision["decision"] === "refuse"
        ? ("reject" as const)
        : ("approve" as const);
    const message = decision["message"];
    const { tenantId } = await apiGetProject(projectId);
    await decideApproval({
      tenantId,
      approvalId,
      decision: choice,
      ...(typeof message === "string" ? { message } : {}),
    });
    return { ok: true };
  },

  // --- Projects -----------------------------------------------------------
  projects: singleFlight(async () => ({
    projects: await apiListProjects("all"),
  })),
  /**
   * Creates the project with one `create_project` mutation. The hub deploys
   * and attaches the coordinator, then mails it `problemStatement` as the
   * first chat message, before that call returns.
   */
  createProject: async (payload: {
    title?: string;
    problemStatement?: string;
    profile?: string;
  }): Promise<{ projectId: string }> => {
    const created = await apiCreateProject({
      ...(payload.title === undefined ? {} : { title: payload.title }),
      ...(payload.problemStatement === undefined
        ? {}
        : { problemStatement: payload.problemStatement }),
      ...(payload.profile === undefined ? {} : { profile: payload.profile }),
    });
    return { projectId: created.projectId };
  },
  updateProject: async (
    projectId: string,
    payload: { title?: string; archived?: boolean; shipped?: boolean },
  ): Promise<{ ok: true }> => {
    if (payload.title !== undefined)
      await apiRenameProject(projectId, payload.title);
    if (payload.archived === true) await apiArchiveProject(projectId);
    if (payload.archived === false) await apiRestoreProject(projectId);
    if (payload.shipped !== undefined)
      await apiShipProject(projectId, payload.shipped);
    return { ok: true };
  },
  exportProject: (projectId: string, sections?: readonly ExportSection[]) =>
    apiExportProject(projectId, sections),
  exportSections: (projectId: string) => apiExportSections(projectId),
  /** A new project from an exported file; resolves once its coordinator is attached. */
  importProject: (file: unknown) => apiImportProject(file),
  readImportFile: (file: Blob) => apiReadImportFile(file),
  /** The hub has soft archive/restore only, so this archives. */
  deleteProject: async (projectId: string): Promise<{ ok: true }> => {
    await apiArchiveProject(projectId);
    return { ok: true };
  },

  // --- Conversation (native run mail) ---------------------------------------
  /**
   * The project's committed conversation events, or null while the project
   * has no bound coordinator (the hub answers 409).
   */
  conversationEvents: (projectId: string) => readConversationEvents(projectId),
  /**
   * Sends one person message. The coordinator is already attached by project
   * creation; this call does not deploy, bind, grant, or store a credential.
   */
  sendMessage: (projectId: string, content: string): Promise<SendReceiptChat> =>
    apiSendMessage(projectId, content),
  /** The latest question to the person, over the conversation's input parks. */
  latestQuestion: (
    events: ConversationEvent[],
    yourAnswerMessageIds: readonly string[],
  ) => apiLatestQuestion(events, yourAnswerMessageIds),
};

/** What `api.sendMessage` resolves with: the hub's 202 receipt and the chat turn it composes. */
export type SendReceiptChat = Awaited<ReturnType<typeof apiSendMessage>>;
