/**
 * The interface's own view types over the hub's responses. Where a field has
 * no hub record, its type says so and it carries an empty value.
 */
import type { ProjectStage } from "@corbits-builder/schemas/project";

export type ApiErrorDetail = {
  code: string;
  message: string;
  correlationId: string;
  retryable: boolean;
};

/** A failed call the interface can name: a refusal or a hub it could not reach. */
export class ApiFailure extends Error {
  readonly detail: ApiErrorDetail;
  readonly httpStatus: number | undefined;
  constructor(detail: ApiErrorDetail, httpStatus?: number) {
    super(detail.message);
    this.name = "ApiFailure";
    this.detail = detail;
    this.httpStatus = httpStatus;
  }
}

/**
 * Something a person's move is waiting on. The hub keeps no stage ledger, so
 * `stage` is null and the bell and gate name "the project" instead.
 */
export type Wait = {
  id: string;
  projectId: string;
  projectTitle?: string;
  /** The project's own child tenant, where its native approvals live. */
  tenantId?: string;
  runId: string;
  /** Always null: the hub keeps no stage ledger. */
  stage: number | null;
  title: string;
  consequence: string;
  /** The native approval this wait resolves, when it is one. */
  approvalId?: string;
  /** When the native approval was raised, so its card sits where it happened. */
  createdAt?: string;
  /** The tool name the native approval was raised for, when the record names one. */
  toolName?: string;
  /** The instruction an instruct_coder or design_app approval carries. */
  instruction?: string;
  /** The ask's first text argument, which a card with no wording of its own names. */
  subject?: string;
  /** The document kinds a request_approval ask approves together. */
  kinds?: readonly string[];
  /** The npm packages a package-install approval names. */
  packages?: readonly string[];
  /** The design concepts a design_app approval starts. */
  concepts?: readonly { readonly label: string; readonly direction: string }[];
  /**
   * The coordinator's open input park: the person's move in the
   * conversation. `parkProse` on the carrying event is the question to show;
   * an absent prose renders the park body verbatim.
   */
  park?: { seq: number; question?: string };
};

/** A project-list summary. `stage` is the hub's, from native state. */
export type ProjectSummary = {
  id: string;
  title: string;
  stage: ProjectStage;
  shippedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  lastActivityAt: string;
};

/** A chat turn as the conversation renders it. */
export type ChatMessage = {
  readonly id: string;
  readonly author: "me" | "agent";
  readonly body: string;
  readonly at: string;
  /** A person turn: the message id the hub minted on its 202 acceptance. */
  readonly triggerMessageId?: string;
};

/** One committed conversation event, verbatim from the hub's contract. */
export type ConversationEvent = {
  seq: number;
  type: string;
  body: Record<string, unknown>;
};

/** A connected-provider row: what the catalog records, with the other fields
 *  empty. */
export type Provider = {
  id: string;
  providerId: string;
  label: string;
  kind: string;
  baseUrl: string | null;
  status: string;
  statusDetail: string | null;
  models: string[];
  active: boolean;
  priority: number;
  hasCredential: boolean;
  validatedAt: string | null;
  selectedModel: string | null;
  enabledModels: string[];
  selectedOfferingId: string | null;
};
