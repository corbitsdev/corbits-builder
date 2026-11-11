import type { TenantRolePage } from "./roles";
import type { QuestionAnswer } from "@intx/types/signals";
import type { PreferenceRegistry } from "@corbits-builder/schemas/preferences";
import type {
  CustomProviderCreate,
  CustomProviderReceipt,
  CustomProviderUpdate,
  ModelCatalog,
  ProviderTest,
  ProviderTestResult,
} from "@corbits-builder/schemas/models";
import type {
  SettingsSave,
  SettingsRecord,
  SettingsReceipt,
} from "@corbits-builder/schemas/settings";
import type {
  ExportSection,
  ProjectExport,
  ProjectImportReceipt,
  ProjectMutation,
  ProjectMutationReceipt,
  ProjectSummaryList,
  ProjectLifecycleReceipt,
  ProjectShipReceipt,
  ProjectView,
} from "@corbits-builder/schemas/project";
import type {
  AcceptanceChecklist,
  AcceptedMaterials,
  UserManual,
  AppSnapshotReceipt,
  AppVersionList,
  ArtifactContent,
  DecidedApprovalList,
  DesignDraft,
  DesignThemeList,
  DesignChoice,
  DesignChoiceReceipt,
  DesignTweaks,
  DesignTweaksReceipt,
  FailedRun,
  InFlightRun,
  LiveApp,
  MaterialReceipt,
  MaterialRemovedReceipt,
} from "@corbits-builder/schemas/artifact";
import type {
  ApprovalRound,
  ApprovalRoundList,
  RecordReviewerDecision,
  StartApprovalRound,
  TriageDecisionInput,
} from "@corbits-builder/schemas/approval-round";
import type { ProjectActivity } from "@corbits-builder/schemas/activity";
import type {
  LiveRunStates,
  ProjectStatus,
} from "@corbits-builder/schemas/project-status";
import type {
  ConversationMessage,
  ConversationReceipt,
  ConversationEvents,
} from "@corbits-builder/schemas/conversation";
import type {
  CreateInvitation,
  Invitation,
  InvitationCreation,
  InvitationList,
} from "@corbits-builder/schemas/invitation";
import type { MePrincipalsPage, Workspace } from "./auth";
import type {
  ModelCredentialInput,
  ModelCredentialReceipt,
  ModelLogin,
  ModelLoginPlugin,
  ModelLoginState,
} from "./credentials";

export type ProductApiClientOptions = Readonly<{
  baseUrl: string | URL;
  headers?: ConstructorParameters<typeof Headers>[0];
  credentials?: Request["credentials"];
  fetch?: (request: Request) => Promise<Response>;
}>;

/** A native approval park: the tool call awaiting a human and its arguments. */
export type NativeApproval = {
  id: string;
  anchorRunId: string;
  status: string;
  toolDefinition: Record<string, unknown>;
  toolArguments: Record<string, unknown>;
  createdAt: string;
};

/** "always" turns the ask into a standing grant for the rest of the run (AUTH.md). */
export type ApprovalScope = "once" | "always";

export type PackageZipReviewerQuery = {
  roundId?: string;
  reviewerId?: string;
  name?: string;
  persona?: string;
};

/** One row of the artifact list route: the current version of a project document. */
export type ProjectArtifact = {
  artifactId: string;
  kind: string;
  title: string;
  version: number;
  sha256: string;
  approvedVersion?: number;
};

export type ProductApiClient = Readonly<{
  addModelCredential(
    tenantId: string,
    input: ModelCredentialInput,
    signal?: AbortSignal,
  ): Promise<ModelCredentialReceipt>;
  /** `name` labels the stored credential and the catalog connection; a unique suffix is added. */
  startModelLogin(
    tenantId: string,
    plugin: ModelLoginPlugin,
    name: string,
    signal?: AbortSignal,
  ): Promise<ModelLogin>;
  modelLogin(
    tenantId: string,
    loginId: string,
    signal?: AbortSignal,
  ): Promise<ModelLoginState>;
  finishModelLogin(
    tenantId: string,
    plugin: ModelLoginPlugin,
    credentialId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<{ id: string }>;

  projectArtifacts(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<{
    artifacts: ProjectArtifact[];
    inFlight: InFlightRun[];
    failed: FailedRun[];
  }>;
  projectActivity(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ProjectActivity>;
  decidedApprovals(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<DecidedApprovalList>;

  preferenceRegistry(
    tenantId: string,
    signal?: AbortSignal,
  ): Promise<PreferenceRegistry>;
  modelCatalog(tenantId: string, signal?: AbortSignal): Promise<ModelCatalog>;
  testProvider(
    tenantId: string,
    input: ProviderTest,
    signal?: AbortSignal,
  ): Promise<ProviderTestResult>;
  /** Adds a custom provider: its connection, key and models at once. The key is never returned. */
  createCustomProvider(
    tenantId: string,
    input: CustomProviderCreate,
    signal?: AbortSignal,
  ): Promise<CustomProviderReceipt>;
  /** Renames a custom provider and replaces its models; a given connection replaces its old one. */
  updateCustomProvider(
    tenantId: string,
    providerId: string,
    input: CustomProviderUpdate,
    signal?: AbortSignal,
  ): Promise<CustomProviderReceipt>;
  removeCustomProvider(
    tenantId: string,
    providerId: string,
    signal?: AbortSignal,
  ): Promise<CustomProviderReceipt>;
  personalSettings(
    tenantId: string,
    signal?: AbortSignal,
  ): Promise<SettingsRecord>;
  savePersonalSettings(
    tenantId: string,
    input: SettingsSave,
    signal?: AbortSignal,
  ): Promise<SettingsReceipt>;

  tenantRoles(tenantId: string, signal?: AbortSignal): Promise<TenantRolePage>;

  createInvitation(
    tenantId: string,
    invitation: typeof CreateInvitation.infer,
    signal?: AbortSignal,
  ): Promise<InvitationCreation>;
  invitations(tenantId: string, signal?: AbortSignal): Promise<InvitationList>;
  revokeInvitation(
    tenantId: string,
    invitationId: string,
    signal?: AbortSignal,
  ): Promise<Invitation>;
  invitation(invitationId: string, signal?: AbortSignal): Promise<Invitation>;
  acceptInvitation(
    invitationId: string,
    signal?: AbortSignal,
  ): Promise<Invitation>;
  nativeApprovals(
    tenantId: string,
    signal?: AbortSignal,
  ): Promise<{ data: NativeApproval[] }>;
  decideNativeApproval(
    tenantId: string,
    approvalId: string,
    decision: "approve" | "reject",
    scope?: ApprovalScope,
    message?: string,
    signal?: AbortSignal,
  ): Promise<NativeApproval>;
  sendMessage(
    projectTenantId: string,
    coordinatorRunId: string,
    message: ConversationMessage,
    signal?: AbortSignal,
  ): Promise<ConversationReceipt>;
  conversationEvents(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ConversationEvents>;
  /** Answers the coordinator's open question, by the ids the run gave its prompts. */
  answerQuestion(
    projectTenantId: string,
    coordinatorRunId: string,
    signalName: string,
    answer: QuestionAnswer,
    signal?: AbortSignal,
  ): Promise<void>;
  mePrincipals(
    query?: { cursor?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<MePrincipalsPage>;
  /** The caller's workspaces under the install root, oldest first. */
  workspaces(signal?: AbortSignal): Promise<{ data: Workspace[] }>;
  /** A new workspace under the install root; the hub picks its slug and makes the caller its owner. */
  createWorkspace(
    input: { name: string },
    signal?: AbortSignal,
  ): Promise<{ id: string }>;
  project(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ProjectView>;
  projects(
    tenantId: string,
    query?: { status?: "active" | "archived" | "all" },
    signal?: AbortSignal,
  ): Promise<typeof ProjectSummaryList.infer>;
  archiveProject(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<typeof ProjectLifecycleReceipt.infer>;
  restoreProject(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<typeof ProjectLifecycleReceipt.infer>;
  /** Marks the project shipped, or clears the mark; either way it stays active and usable. */
  shipProject(
    tenantId: string,
    projectId: string,
    shipped: boolean,
    signal?: AbortSignal,
  ): Promise<ProjectShipReceipt>;
  /** Starts the project's coordinator when it is not running; a project with filed work resumes. */
  startProjectCoordinator(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<{ started: boolean }>;
  projectNextStep(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ProjectStatus>;
  projectRunStates(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<LiveRunStates>;
  mutateProject(
    tenantId: string,
    projectId: string,
    mutation: ProjectMutation,
    signal?: AbortSignal,
  ): Promise<typeof ProjectMutationReceipt.infer>;
  versionProject(
    tenantId: string,
    sourceProjectId: string,
    input: { title: string },
    signal?: AbortSignal,
  ): Promise<typeof ProjectMutationReceipt.infer>;
  exportProject(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ProjectExport>;
  importProject(
    tenantId: string,
    file: ProjectExport,
    signal?: AbortSignal,
  ): Promise<ProjectImportReceipt>;
  artifact(
    tenantId: string,
    projectId: string,
    artifactId: string,
    version?: number,
    signal?: AbortSignal,
  ): Promise<typeof ArtifactContent.infer>;
  /** Without a concept, the designer working on the design itself. */
  designDraft(
    tenantId: string,
    projectId: string,
    concept?: string,
    signal?: AbortSignal,
  ): Promise<DesignDraft>;
  /** The prebuilt design themes a person previews and picks before any design exists. */
  designThemes(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<DesignThemeList>;
  designTheme(
    tenantId: string,
    projectId: string,
    themeId: string,
    signal?: AbortSignal,
  ): Promise<DesignDraft>;
  acceptance(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<AcceptanceChecklist>;
  /** The app's user manual with its pictures, from the live coder or the filed app. */
  manual(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<UserManual>;
  liveApp(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<LiveApp>;
  keepLiveApp(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<LiveApp>;
  /** Files the latest coder workspace, live or ended, as the next app version if it changed. */
  snapshotApp(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<AppSnapshotReceipt>;
  /** Every filed app version, newest first. */
  appVersions(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<AppVersionList>;
  /** A filed app version (the saved app when absent) as a zip named after the project. */
  downloadApp(
    tenantId: string,
    projectId: string,
    version?: number,
    signal?: AbortSignal,
  ): Promise<{ filename: string; archive: Blob }>;
  /**
   * The project as a zip of the given sections (all when absent), always with project.json; the
   * app in both is the filed version named, else the saved app.
   */
  exportProjectArchive(
    tenantId: string,
    projectId: string,
    sections?: readonly ExportSection[],
    version?: number,
    signal?: AbortSignal,
  ): Promise<{ filename: string; archive: Blob }>;
  /** Sets look tokens in the design's styles.css; never an approval. */
  saveDesignTweaks(
    tenantId: string,
    projectId: string,
    input: DesignTweaks,
    signal?: AbortSignal,
  ): Promise<DesignTweaksReceipt>;
  /** The person chooses a filed design option at its version; it becomes the approved design. */
  chooseDesign(
    tenantId: string,
    projectId: string,
    input: DesignChoice,
    signal?: AbortSignal,
  ): Promise<DesignChoiceReceipt>;
  /** The file types the coordinator's model reads; an empty list accepts none. */
  acceptedMaterials(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<AcceptedMaterials>;
  /** Files each file as a material and mails them to the coordinator with the message. */
  attachMaterials(
    tenantId: string,
    projectId: string,
    files: readonly File[],
    message?: string,
    signal?: AbortSignal,
  ): Promise<MaterialReceipt>;
  /** Takes an attached file back: the material is archived and the coordinator told. */
  removeMaterial(
    tenantId: string,
    projectId: string,
    artifactId: string,
    signal?: AbortSignal,
  ): Promise<MaterialRemovedReceipt>;
  /** A filed approval_package version as a deterministic zip of its deck, PDF, README, manifest and documents. */
  downloadPackageZip(
    tenantId: string,
    projectId: string,
    version: number,
    signalOrReviewer?: AbortSignal | PackageZipReviewerQuery,
    signal?: AbortSignal,
  ): Promise<{ filename: string; archive: Blob }>;
  /** Every approval round of the project, newest first. */
  approvalRounds(
    tenantId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ApprovalRoundList>;
  /** Approves the package version as the calling person and opens a review round. */
  startApprovalRound(
    tenantId: string,
    projectId: string,
    input: StartApprovalRound,
    signal?: AbortSignal,
  ): Promise<ApprovalRound>;
  /** Records or amends one reviewer's decision on an open approval round. */
  recordReviewerDecision(
    tenantId: string,
    projectId: string,
    roundId: string,
    reviewerId: string,
    input: RecordReviewerDecision,
    signal?: AbortSignal,
  ): Promise<ApprovalRound>;
  /** Marks the round settled once every reviewer decided or the round expired. */
  settleApprovalRound(
    tenantId: string,
    projectId: string,
    roundId: string,
    signal?: AbortSignal,
  ): Promise<ApprovalRound>;
  /** Records the owner's triage decision on a reviewer feedback bullet, mailing the coordinator when incorporated. */
  triageReviewerFeedback(
    tenantId: string,
    projectId: string,
    roundId: string,
    itemId: string,
    input: TriageDecisionInput,
    signal?: AbortSignal,
  ): Promise<ApprovalRound>;
}>;

export class ProductApiError extends Error {
  constructor(readonly response: Response) {
    super(response.statusText);
    this.name = "ProductApiError";
  }
}

export type ClientDeps = {
  request: <T>(
    path: string,
    signal?: AbortSignal,
    mutation?: unknown,
    method?: "POST" | "PATCH" | "DELETE",
  ) => Promise<T>;
  baseUrl: URL;
  headers: Headers;
  fetchRequest: (request: Request) => Promise<Response>;
  options: ProductApiClientOptions;
};

export function tenantPath(tenantId: string): string {
  return `/api/tenants/${encodeURIComponent(tenantId)}`;
}

export function projectPath(tenantId: string, projectId: string): string {
  return `${tenantPath(tenantId)}/projects/${encodeURIComponent(projectId)}`;
}
