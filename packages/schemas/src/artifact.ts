import { type } from "arktype";
import { SpawnedRole } from "./roles.ts";
import { Preferences } from "./preferences.ts";
import { OpenQuestions } from "./questions.ts";
import { ApproachesMeta } from "./approaches.ts";

const text = type("string > 0").atMostLength(512);
const sha256 = /^[a-f0-9]{64}$/;

// Documents a model writes as text. A design concept's option is filed from the designer's
// workspace by file_design_option, the design by the person's choice among the options, and the
// app from the coder's workspace each time check-app passes.
const DocumentKind = type(
  "'problem_brief' | 'constraints' | 'approaches' | 'product_requirements' | 'build_plan'",
);
const WritableArtifactKind = DocumentKind.or(
  "'design' | 'design_option' | 'app'",
);
const content = type("string > 0").atMostLength(256 * 1024);
export const DocumentContent = content;
// A working weather app packed to about 270 KB of source.
export const MAX_APP_BYTES = 1024 * 1024;

// A filed app runs up to MAX_APP_BYTES, which the hub checks in bytes; it holds every other kind to
// DocumentContent.
export const ArtifactKindWrite = type({
  "+": "reject",
  kind: WritableArtifactKind,
  title: text,
  content: type("string > 0").atMostLength(MAX_APP_BYTES),
  "openQuestions?": OpenQuestions,
  "approaches?": ApproachesMeta,
});
export type ArtifactKindWrite = typeof ArtifactKindWrite.infer;
export const DocumentWrite = type({
  "+": "reject",
  kind: DocumentKind,
  title: text,
  content,
  "openQuestions?": OpenQuestions,
  "approaches?": ApproachesMeta,
});

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

// The coordinator records the concept a designer run it just deployed works on.
export const DesignConceptRecord = type({
  "+": "reject",
  runId: "string > 0",
  concept: DesignConcept,
});
export type DesignConceptRecord = typeof DesignConceptRecord.infer;

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

// The project's app as the person can open it, served by the hub at url, the app's own origin.
// The hub runs it while the project is open from the project's current files: the build
// workspace's (source builder) while a coder builds, else the newer of the latest filed version
// (source filed) and the latest commit of the app repository's main (source repository).
// Starting names its phase; a failed app carries its error and the last lines of its log.
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

export const ArtifactListItem = type({
  "+": "reject",
  artifactId: "string > 0",
  kind: "string > 0",
  title: "string > 0",
  version: "number.integer > 0",
  sha256,
  filedAt: "string > 0",
  "approvedVersion?": "number.integer > 0",
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
  // Mid-turn, or parked between turns waiting for mail; a parked run is idle, not at work.
  state: "'working' | 'waiting'",
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
export const ArtifactList = type({
  "+": "reject",
  artifacts: ArtifactListItem.array(),
  inFlight: InFlightRun.array(),
  failed: FailedRun.array(),
  // The kinds of filed documents whose current version waits on the person's approval.
  awaitingApproval: type("string > 0").array(),
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

// A file the person attached to the project, filed under its filename; attaching the same name
// again files its next version. A text file's content is its text, any other file's a base64
// data: URL.
export const MATERIAL_KIND = "material";

export const MaterialReceipt = type({
  "+": "reject",
  materials: ArtifactRef.array(),
});
export type MaterialReceipt = typeof MaterialReceipt.infer;

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
