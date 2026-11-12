import { type } from "arktype";
import { SpawnedRole } from "./roles.ts";
import { Preferences } from "./preferences.ts";
import { OpenQuestions } from "./questions.ts";
import { ApproachesMeta } from "./approaches.ts";

const text = type("string > 0").atMostLength(512);
const sha256 = /^[a-f0-9]{64}$/;

// The documents with a writer, fields and a template of their own.
export const WriterDocumentKind = type("'product_requirements' | 'build_plan'");
export type WriterDocumentKind = typeof WriterDocumentKind.infer;
// What no model writes as text. A design concept's option is filed from the designer's workspace
// by file_design_option, the design by the person's choice among the options, the app from the
// coder's workspace each time check-app passes, and the approval package by the presenter.
const BUNDLE_KINDS = [
  "design",
  "design_option",
  "app",
  "approval_package",
] as const;
// A file the person attached to the project, filed under its filename; attaching the same name
// again files its next version. A text file's content is its text, any other file's a base64
// data: URL.
export const MATERIAL_KIND = "material";
// Any kind a model writes as text: a short slug, the known kinds among them. A kind the hub does not
// know is simply a document, filed, versioned, reviewed and approved like the known ones. A pattern
// rather than a narrow, so a tool's input schema carries it.
export const DocumentKind = type(
  new RegExp(
    `^(?!(?:${[...BUNDLE_KINDS, MATERIAL_KIND].join("|")})$)[a-z][a-z0-9_]{0,63}$`,
  ),
).describe("a document kind: a short lowercase slug such as build_plan");
export const isDocumentKind = (kind: string) => DocumentKind.allows(kind);
const WritableArtifactKind = DocumentKind.or(type.enumerated(...BUNDLE_KINDS));
const content = type("string > 0").atMostLength(256 * 1024);
export const DocumentContent = content;
export const MAX_APPROVAL_PACKAGE_BYTES = 4 * 1024 * 1024;

// A filed approval package runs up to MAX_APPROVAL_PACKAGE_BYTES, which the hub checks in bytes,
// and a filed app is as large as the app is; the hub holds every other kind to DocumentContent.
export const ArtifactKindWrite = type({
  "+": "reject",
  kind: WritableArtifactKind,
  title: text,
  content: "string > 0",
  "openQuestions?": OpenQuestions,
  "approaches?": ApproachesMeta,
});
export type ArtifactKindWrite = typeof ArtifactKindWrite.infer;
const documentFields = {
  title: text,
  content,
  "openQuestions?": OpenQuestions,
};
// The fields a writer saves, by the kind it was deployed for; the hub files it under that kind, and a
// kind the writer repeats from its task must match. A flat object, since some providers read only a
// tool schema's top-level properties and send nothing for a union.
export const WriterDocumentFields = {
  product_requirements: type({
    "+": "reject",
    "kind?": "'product_requirements'",
    ...documentFields,
  }),
  build_plan: type({
    "+": "reject",
    "kind?": "'build_plan'",
    ...documentFields,
  }),
};
// The fields a writer of any document saves, under the kind its task names.
export const AnyDocumentFields = type({
  "+": "reject",
  kind: DocumentKind,
  ...documentFields,
});
export const DocumentWrite = type({
  "+": "reject",
  kind: DocumentKind,
  title: text,
  content,
  "openQuestions?": OpenQuestions,
  "approaches?": ApproachesMeta,
});

export const ApprovalPackageSource = type({
  "+": "reject",
  artifactId: "string > 0",
  kind: "string > 0",
  title: "string > 0",
  version: "number.integer > 0",
  sha256,
});
export type ApprovalPackageSource = typeof ApprovalPackageSource.infer;

export const ApprovalPackageManifest = type({
  "+": "reject",
  audience: "string > 0",
  decisionNeeded: "string > 0",
  tone: "string > 0",
  length: "string > 0",
  sources: ApprovalPackageSource.array().atLeastLength(1),
});
export type ApprovalPackageManifest = typeof ApprovalPackageManifest.infer;

export const ApprovalPackageBundle = type({
  "+": "reject",
  manifest: ApprovalPackageManifest,
  deck: "Record<string, unknown>",
  pptxBase64: "string > 0",
  pdfBase64: "string > 0",
  "documents?": { "[string]": "string" },
});
export type ApprovalPackageBundle = typeof ApprovalPackageBundle.infer;

// A design document's content: the designer's .builder files keyed by path, DESIGN.md and
// designs/index.html among them.
export const DesignBundle = type({
  "+": "reject",
  files: type({ "[string]": "string" }).narrow(
    (files, ctx) =>
      ("DESIGN.md" in files && "designs/index.html" in files) ||
      ctx.mustBe("a bundle with DESIGN.md and designs/index.html"),
  ),
});
export type DesignBundle = typeof DesignBundle.infer;

// One look a designer explores for the person to compare: a short label and its art direction.
export const DesignConcept = type({
  "+": "reject",
  label: type("string > 0").atMostLength(80),
  direction: type("string > 0").atMostLength(600),
});
export type DesignConcept = typeof DesignConcept.infer;

// The coordinator records the concept a run it just deployed works on.
export const DesignConceptRecord = type({
  "+": "reject",
  runId: "string > 0",
  concept: DesignConcept,
});
export type DesignConceptRecord = typeof DesignConceptRecord.infer;

// What a plugin's starter records against a run it just deployed, before the run's assignment: a
// concept the run works on, or the sources a presentation pins.
export const RunRecord = type({
  "+": "reject",
  runId: "string > 0",
  name: "'concept' | 'presentation'",
  data: "unknown",
});
export type RunRecord = typeof RunRecord.infer;

// The live designer's .builder/designs before it files: unfiled, unversioned and unapproved.
export const DesignDraft = type({
  "+": "reject",
  files: type({ "[string]": "string" }).narrow(
    (files, ctx) =>
      "designs/index.html" in files ||
      ctx.mustBe("a draft with designs/index.html"),
  ),
});
export type DesignDraft = typeof DesignDraft.infer;

// The prebuilt design themes a person previews and picks from before any design exists: a
// catalog concept with a sample design bundle of its own, read whole through its id.
export const DesignThemeList = type({
  "+": "reject",
  themes: type({
    "+": "reject",
    id: "string > 0",
    label: "string > 0",
    direction: "string > 0",
  }).array(),
});
export type DesignThemeList = typeof DesignThemeList.infer;

// Each value is one CSS token value with no character that could end its declaration or rule.
const hex = "#[0-9a-fA-F]{3,8}";
const color = type(
  new RegExp(
    `^(${hex}|color-mix\\(in srgb, ?${hex} \\d{1,3}%, ?(black|white)\\))$`,
  ),
);
const length = type(/^(0|\d{1,3}(\.\d{1,4})?(rem|px|em))$/);
const fontFamily = `("[A-Za-z0-9 -]{1,40}"|-?[A-Za-z][A-Za-z0-9-]{0,40}( [A-Za-z0-9-]{1,40}){0,3})`;
const fontList = type(new RegExp(`^${fontFamily}(, ?${fontFamily}){0,7}$`));

// The look tokens the person saved from the mockup's tweak panel, written into the design's
// styles.css :root. A save is not an approval and moves nothing forward.
export const DesignTweaks = type({
  "+": "reject",
  tokens: type({
    "+": "reject",
    "primary?": color,
    "primary-foreground?": color,
    "primary-active?": color,
    "ring?": color,
    "background?": color,
    "radius?": length,
    "font-sans?": fontList,
    "font-mono?": fontList,
  }).narrow(
    (tokens, ctx) =>
      Object.keys(tokens).length > 0 || ctx.mustBe("at least one token"),
  ),
  // The design concept whose live designer to update, as design-draft's concept names it.
  "concept?": type("string > 0").atMostLength(80),
});
export type DesignTweaks = typeof DesignTweaks.infer;

// The live coder's working copy of the build plan's acceptance checklist, ticked as items pass. The
// filed plan is approved by its hash, so the ticks live here and never version the plan.
export const AcceptanceChecklist = type({ "+": "reject", markdown: "string" });
export type AcceptanceChecklist = typeof AcceptanceChecklist.infer;

// The app's user manual, docs/USER-MANUAL.md, as the coder keeps it or as filed with the app, with
// each picture it shows keyed as the markdown names it ("manual/home.png") and carried as a data URL.
export const UserManual = type({
  "+": "reject",
  markdown: "string",
  pictures: { "[string]": "string" },
});
export type UserManual = typeof UserManual.infer;

// The project's app as the person can open it, served by the hub at url, the app's own origin.
// The hub runs it while the project is open from the project's current files: the build
// workspace's (source builder) while a coder builds, else the saved app: the latest commit of the
// app repository's main (source repository) or, for a project from before app repositories, its
// latest filed version (source filed). Starting names its phase; a failed app carries its error
// and the last lines of its log.
export const LiveApp = type({
  "+": "reject",
  state: "'not_built' | 'stopped' | 'starting' | 'running' | 'failed'",
  "source?": "'builder' | 'filed' | 'repository'",
  "version?": "number.integer > 0",
  "commit?": "string",
  "phase?": "'installing' | 'starting'",
  "url?": "string",
  "error?": "string",
  "log?": "string[]",
  // The demo account the app seeds, from the starter's demo account file in its current files.
  "demoLogin?": { "+": "reject", email: "string", password: "string" },
});
export type LiveApp = typeof LiveApp.infer;

// An app document's content: the coder's app source keyed by path, in the design bundle's shape.
// Files that are not UTF-8 text are kept base64-encoded under binary; bundles filed before binaries
// were kept have none.
export const AppBundle = type({
  "+": "reject",
  files: type({ "[string]": "string" }).narrow(
    (files, ctx) =>
      "package.json" in files || ctx.mustBe("a bundle with package.json"),
  ),
  "binary?": { "[string]": "string" },
});
export type AppBundle = typeof AppBundle.infer;

// What filed an app version: a passing check-app in the coder's run, a person's snapshot of the
// latest coder workspace, or a person's import. Versions filed before sources were recorded have none.
const AppVersionSource = type("'check' | 'snapshot' | 'import'");
export const AppVersionMetadata = type({
  source: AppVersionSource,
  "runId?": "string > 0",
  bytes: "number.integer >= 0",
});
export type AppVersionMetadata = typeof AppVersionMetadata.infer;

export const AppVersion = type({
  "+": "reject",
  version: "number.integer > 0",
  createdAt: "string",
  "source?": AppVersionSource,
  "runId?": "string > 0",
  "bytes?": "number.integer >= 0",
});
export type AppVersion = typeof AppVersion.infer;
// Whether this viewer can snapshot the project's newest coder workspace now, or why not: they may
// only read the project, no coder has run, or its workspace cannot be read by this hub.
export const AppSnapshotState = type({
  "+": "reject",
  ready: "true",
  runId: "string > 0",
}).or({
  "+": "reject",
  ready: "false",
  code: "'forbidden' | 'coder_run_not_found' | 'app_workspace_unavailable'",
  "runId?": "string > 0",
  "reason?":
    "'not_on_local_sidecar' | 'workspace_missing' | 'package_json_missing'",
});
export type AppSnapshotState = typeof AppSnapshotState.infer;
// Versions newest first.
export const AppVersionList = type({
  "+": "reject",
  versions: AppVersion.array(),
  snapshot: AppSnapshotState,
});
export type AppVersionList = typeof AppVersionList.infer;

export const ArtifactRef = type({
  "+": "reject",
  artifactId: "string > 0",
  kind: "string > 0",
  version: "number.integer > 0",
  sha256,
});
export type ArtifactRef = typeof ArtifactRef.infer;

export const ArtifactReceipt = type({ "+": "reject", artifact: ArtifactRef });

// A snapshot names the version that now holds the workspace; filed is false when the latest
// version already held exactly these files.
export const AppSnapshotReceipt = type({
  "+": "reject",
  artifact: ArtifactRef,
  filed: "boolean",
  runId: "string > 0",
});
export type AppSnapshotReceipt = typeof AppSnapshotReceipt.infer;

// Where saved look tokens landed: the live designer's workspace, the filed design's next
// version, or both; and which runs were told.
export const DesignTweaksReceipt = type({
  "+": "reject",
  updated: type("'workspace' | 'version'").array().atLeastLength(1),
  "artifact?": ArtifactRef,
  notified: "('coordinator' | 'designer')[]",
});
export type DesignTweaksReceipt = typeof DesignTweaksReceipt.infer;

// The project values asked for by name, each as stored, any JSON, or null when the project has
// none yet. Asked for with no names, every declared value comes, with what each holds and the type
// or types it takes.
export const ProjectValues = type({
  "+": "reject",
  values: { "[string]": "unknown" },
  "declared?": {
    "[string]": {
      "+": "reject",
      about: "string > 0",
      types: type("string > 0").array().atLeastLength(1),
    },
  },
});
export type ProjectValues = typeof ProjectValues.infer;

// Project values to save by name; the hub checks each against the type its declaration names.
export const ProjectValuesWrite = type({
  "+": "reject",
  values: type({ "[string]": "unknown" }).narrow(
    (values, ctx) =>
      Object.keys(values).length > 0 || ctx.mustBe("at least one value"),
  ),
});
export type ProjectValuesWrite = typeof ProjectValuesWrite.infer;

// The person's choice of a filed design option at the version they saw; the hub files it as the
// design and records the person's approval of exactly that design version.
export const DesignChoice = type({
  "+": "reject",
  artifactId: "string > 0",
  version: "number.integer > 0",
});
export type DesignChoice = typeof DesignChoice.infer;

export const DesignChoiceReceipt = type({
  "+": "reject",
  design: ArtifactRef,
  concept: "string > 0",
});
export type DesignChoiceReceipt = typeof DesignChoiceReceipt.infer;

// The person approves a filed document at the version they read, with no question asking for it.
export const DocumentApproval = type({
  "+": "reject",
  version: "number.integer > 0",
});
export type DocumentApproval = typeof DocumentApproval.infer;

// The approval recorded, and the open question it answered when it covered all that one asked for.
export const DocumentApprovalReceipt = type({
  "+": "reject",
  artifactId: "string > 0",
  kind: "string > 0",
  version: "number.integer > 0",
  "answered?": "string > 0",
});
export type DocumentApprovalReceipt = typeof DocumentApprovalReceipt.infer;

export const ArtifactListItem = type({
  "+": "reject",
  artifactId: "string > 0",
  kind: "string > 0",
  title: "string > 0",
  version: "number.integer > 0",
  sha256,
  filedAt: "string > 0",
  "approvedVersion?": "number.integer > 0",
  // When the person recorded that approval, where the record says.
  "approvedAt?": "string > 0",
  // How many open questions the current version leaves for the person; none when absent.
  "openQuestionCount?": "number.integer > 0",
});
export type ArtifactListItem = typeof ArtifactListItem.infer;
// What a run's own native tool events showed the hub since it started: its turns, its latest calls
// as "tool subject", and the files its successful write_file and edit_file calls wrote.
export const RunProgress = type({
  "+": "reject",
  turns: "number.integer >= 0",
  recent: type("string > 0").array().atMostLength(5),
  filesWritten: "number.integer >= 0",
  files: type("string > 0").array().atMostLength(8),
  lastActivityAt: "string > 0",
});
export type RunProgress = typeof RunProgress.infer;
// A specialist run Interchange reports as deployed or running in the project.
export const InFlightRun = type({
  "+": "reject",
  runId: "string > 0",
  role: SpawnedRole,
  startedAt: "string > 0",
  // Interchange's run status: deployed until its first assignment arrives, then running.
  status: "'deployed' | 'running'",
  // Mid-turn; parked between turns waiting for mail, which is idle, not at work; or mid-turn but
  // held on an approval only the person can give, so nothing moves until they answer.
  state: "'working' | 'waiting' | 'approval'",
  // When the current state began, once the hub has seen the run start or end a turn.
  "since?": "string > 0",
  // The design concept a designer run works on, filed as that concept's design_option.
  "concept?": "string > 0",
  "progress?": RunProgress,
});
export type InFlightRun = typeof InFlightRun.infer;
// A specialist run Interchange settled as failed, with the error its terminal event carries.
export const FailedRun = type({
  "+": "reject",
  runId: "string > 0",
  role: SpawnedRole,
  endedAt: "string > 0",
  "error?": { "+": "reject", message: "string", "code?": "string" },
});
export type FailedRun = typeof FailedRun.infer;
// The plugin action the coordinator started a specialist run for, recorded before its assignment.
export const RunAction = type({
  "+": "reject",
  runId: "string > 0",
  plugin: "string > 0",
  action: "string > 0",
});
// A run the coordinator started in the project, at work or ended lately.
export const ProjectRun = RunAction.merge({
  "concept?": "string > 0",
  // Interchange's run status.
  status: "'deployed' | 'running' | 'completed' | 'failed' | 'cancelled'",
  // While it runs, as inFlight says it: working, waiting between turns, or held on an approval; or
  // starting, before its first turn.
  "state?": "'starting' | 'working' | 'waiting' | 'approval'",
  startedAt: "string > 0",
  "endedAt?": "string > 0",
  // Its latest tool call as tool and what it was given, and when it last acted, as far as the hub saw.
  "lastActivity?": "string > 0",
  "lastActivityAt?": "string > 0",
  // Why a failed run stopped.
  "error?": "string > 0",
});
export type ProjectRun = typeof ProjectRun.infer;
export const ProjectRuns = type({ "+": "reject", runs: ProjectRun.array() });
// A check of a plugin to run on its input, against the project as saved.
export const CheckRun = type({
  "+": "reject",
  plugin: "string > 0",
  action: "string > 0",
  "input?": "object",
});
// What running a check answers: its result, or for one that keeps trying, the id of the record its
// result will be written to.
export const CheckRan = type({
  "+": "reject",
  ran: "true",
  checkId: "string > 0",
  plugin: "string > 0",
  action: "string > 0",
  result: "'pass' | 'fail'",
  summary: "string > 0",
  evidence: "string[]",
}).or({
  "+": "reject",
  started: "true",
  checkId: "string > 0",
  plugin: "string > 0",
  action: "string > 0",
});
// The latest record of one check of the project, for one input.
export const CheckRecord = type({
  "+": "reject",
  checkId: "string > 0",
  plugin: "string > 0",
  action: "string > 0",
  input: "object",
  result: "'pass' | 'fail' | 'skipped'",
  summary: "string > 0",
  evidence: "string[]",
  // What it read, each at the version it read: the app, each document, approval and value.
  versions: { "[string]": "string | number | boolean | null" },
  // Whether each of those is still what the project has saved.
  current: "boolean",
  // The facts a pass or skip of it makes true while it is current.
  returns: "string[]",
  // A person's principal, the coordinator's run, or the hub.
  triggeredBy: "string > 0",
  "skippedBy?": "string > 0",
  createdAt: "string > 0",
});
export type CheckRecord = typeof CheckRecord.infer;
export const CheckList = type({ "+": "reject", checks: CheckRecord.array() });
export const ArtifactList = type({
  "+": "reject",
  artifacts: ArtifactListItem.array(),
  inFlight: InFlightRun.array(),
  failed: FailedRun.array(),
  // The kinds of filed documents whose current version waits on the person's approval.
  awaitingApproval: type("string > 0").array(),
  // Whether the app's first build is done: a version filed after a coder's passing check.
  appBuilt: "boolean",
  // How the person wants to work: every choice, and the guidance for the reading role.
  preferences: Preferences,
  preferenceGuidance: type("string > 0").array(),
});
export type ArtifactList = typeof ArtifactList.infer;

export const ArtifactRead = type({
  "+": "reject",
  "artifactId?": "string > 0",
  "kind?": "string > 0",
  "version?": "number.integer > 0",
});
export type ArtifactRead = typeof ArtifactRead.infer;

export const ArtifactContent = type({
  "+": "reject",
  artifactId: "string > 0",
  kind: "string > 0",
  title: "string > 0",
  version: "number.integer > 0",
  sha256,
  filedAt: "string > 0",
  content: "string",
  "openQuestions?": OpenQuestions,
  "approaches?": ApproachesMeta,
});
export type ArtifactContent = typeof ArtifactContent.infer;

export const ArtifactApprovalRecord = type({
  "+": "reject",
  tool: "'request_approval' | 'instruct_coder'",
  artifacts: ArtifactRef.array().atLeastLength(1),
});
export type ArtifactApprovalRecord = typeof ArtifactApprovalRecord.infer;

export const ArtifactApprovalReceipt = type({
  "+": "reject",
  approvalId: "string > 0",
  artifacts: ArtifactRef.array(),
});
export type ArtifactApprovalReceipt = typeof ArtifactApprovalReceipt.infer;

// A native approval no longer pending, as its record settled it, with the exact document versions
// the hub recorded it approving. The tool's arguments are the ask the person saw on its card.
export const DecidedApproval = type({
  "+": "reject",
  approvalId: "string > 0",
  toolName: "string > 0",
  toolArguments: "Record<string, unknown>",
  status: "'approved' | 'rejected' | 'timeout' | 'expired'",
  scope: "'once' | 'always' | null",
  createdAt: "string > 0",
  resolvedAt: "string > 0 | null",
  documents: type({
    "+": "reject",
    kind: "string > 0",
    version: "number.integer > 0",
  }).array(),
});
export type DecidedApproval = typeof DecidedApproval.infer;

export const DecidedApprovalList = type({
  "+": "reject",
  approvals: DecidedApproval.array(),
});
export type DecidedApprovalList = typeof DecidedApprovalList.infer;

export const MaterialReceipt = type({
  "+": "reject",
  materials: ArtifactRef.array(),
});
export type MaterialReceipt = typeof MaterialReceipt.infer;

// A material the person took back: archived, so it leaves every list while its versions stay.
export const MaterialRemovedReceipt = type({
  "+": "reject",
  artifactId: "string > 0",
  title: "string",
  // Whether a running coordinator was told the file is withdrawn.
  told: "boolean",
});
export type MaterialRemovedReceipt = typeof MaterialRemovedReceipt.infer;

// The attachment types the project's coordinator model reads, and Interchange's attachment limits.
// Empty when the model's catalog offering declares neither vision-input nor document-input.
export const AcceptedMaterials = type({
  "+": "reject",
  mimeTypes: "string[]",
  maxFiles: "number.integer > 0",
  maxFileBytes: "number.integer > 0",
  maxTotalBytes: "number.integer > 0",
});
export type AcceptedMaterials = typeof AcceptedMaterials.infer;
