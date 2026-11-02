import type {
  TenantGrantInput,
  TenantGrantPage,
  TenantGrantView,
  TenantRolePage,
  TenantRoleView,
} from "./roles";
import type { DiscoveredModels } from "@corbits-builder/schemas/catalog";
import type { SettingsProviders } from "@corbits-builder/schemas/settings";
import type { PreferenceRegistry } from "@corbits-builder/schemas/preferences";
import type {
  ModelCatalog,
  ProviderTest,
  ProviderTestResult,
} from "@corbits-builder/schemas/models";
import type {
  AuditQuery,
  ProjectAuditPage,
} from "@corbits-builder/schemas/audit";
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
import type { InstalledWorkflows } from "@corbits-builder/schemas/installed-workflows";
import type { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import type {
  BindCoordinator,
  CoordinatorBindingReceipt,
} from "@corbits-builder/schemas/coordinator";
import type {
  AcceptanceChecklist,
  AcceptedMaterials,
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
import type {
  MePrincipalsPage,
  MeProfile,
  Tenant,
  HelloResponse,
  Workspace,
} from "./auth";
import type { CatalogModelView, CatalogOfferingView } from "./catalog";
import type {
  ModelCredentialInput,
  ModelCredentialReceipt,
  ModelLogin,
  ModelLoginPlugin,
  ModelLoginState,
  ModelProviderView,
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
  models(tenantId: string, signal?: AbortSignal): Promise<DiscoveredModels>;
  settingsProviders(
    tenantId: string,
    signal?: AbortSignal,
  ): Promise<SettingsProviders>;
  modelProviders(
    tenantId: string,
    signal?: AbortSignal,
  ): Promise<ModelProviderView[]>;
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
  projectAudit(
    tenantId: string,
    projectId: string,
    query?: AuditQuery,
    signal?: AbortSignal,
  ): Promise<ProjectAuditPage>;

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

  settings(
    tenantId: string,
    projectId?: string,
    signal?: AbortSignal,
  ): Promise<SettingsRecord>;
  saveSettings(
    tenantId: string,
    projectId: string | undefined,
    input: SettingsSave,
    signal?: AbortSignal,
  ): Promise<SettingsReceipt>;
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
  createTenantRole(
    tenantId: string,
    input: { name: string; description?: string },
    signal?: AbortSignal,
  ): Promise<TenantRoleView>;
  tenantGrants(
    tenantId: string,
    query?: { roleId?: string; principalId?: string },
    signal?: AbortSignal,
  ): Promise<TenantGrantPage>;
  createTenantGrant(
    tenantId: string,
    input: TenantGrantInput,
    signal?: AbortSignal,
  ): Promise<TenantGrantView>;

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
  nativeApproval(
    tenantId: string,
    approvalId: string,
    signal?: AbortSignal,
  ): Promise<NativeApproval>;
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
  hello(tenantId: string, signal?: AbortSignal): Promise<HelloResponse>;
  me(signal?: AbortSignal): Promise<MeProfile>;
  createTenant(
    input: { name: string; slug: string },
    signal?: AbortSignal,
  ): Promise<Tenant>;
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
  installedWorkflows(
    tenantId: string,
    signal?: AbortSignal,
  ): Promise<InstalledWorkflows>;
  deployNativeWorkflow(
    tenantId: string,
    input: NativeSpecialistDeployment,
    signal?: AbortSignal,
  ): Promise<{ id: string; status: string }>;
  nativeDeployments(
    tenantId: string,
    signal?: AbortSignal,
  ): Promise<{ id: string; status: string }[]>;
  bindProjectCoordinator(
    tenantId: string,
    projectId: string,
    input: typeof BindCoordinator.infer,
    signal?: AbortSignal,
  ): Promise<typeof CoordinatorBindingReceipt.infer>;
  createTenantProvider(
    tenantId: string,
    input: { name: string; plugin: string; apiBaseUrl: string },
    signal?: AbortSignal,
  ): Promise<{ id: string }>;
  createTenantCredential(
    tenantId: string,
    input: {
      providerId: string;
      name: string;
      type: string;
      secret: string;
      description?: string;
    },
    signal?: AbortSignal,
  ): Promise<{ id: string }>;
  createCatalogModel(
    tenantId: string,
    input: { canonicalName: string },
    signal?: AbortSignal,
  ): Promise<CatalogModelView>;
  createCatalogOffering(
    tenantId: string,
    input: { modelId: string; providerId: string },
    signal?: AbortSignal,
  ): Promise<CatalogOfferingView>;
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
  /** A filed app version (the latest when absent) as a zip named after the project. */
  downloadApp(
    tenantId: string,
    projectId: string,
    version?: number,
    signal?: AbortSignal,
  ): Promise<{ filename: string; archive: Blob }>;
  /** The project as a zip of the given sections (all when absent), always with project.json. */
  exportProjectArchive(
    tenantId: string,
    projectId: string,
    sections?: readonly ExportSection[],
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
  /** A filed approval_package version as a deterministic zip of its deck, PDF, README, manifest and documents. */
  downloadPackageZip(
    tenantId: string,
    projectId: string,
    version: number,
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
    method?: "POST" | "PATCH",
  ) => Promise<T>;
  catalogResponse: (path: string, signal?: AbortSignal) => Promise<unknown>;
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
