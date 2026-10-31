import { type } from "arktype";
import { ArtifactKindWrite, DocumentContent } from "./artifact.ts";
import { ProfileId } from "./models.ts";

export const ProjectId = type(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const text = type("string > 0").atMostLength(2000);
const opening = type("string > 0").atMostLength(64 * 1024);
export const ProjectMutation = type.or(
  {
    "+": "reject",
    mutationId: ProjectId,
    idempotencyKey: ProjectId,
    command: "'create_project'",
    // The model profile the project runs on; the creator's active one when absent. The opening
    // idea is not stored: it becomes the coordinator's first mail.
    payload: {
      "+": "reject",
      title: text,
      "profile?": ProfileId,
      "problemStatement?": opening,
    },
  },
  {
    "+": "reject",
    mutationId: ProjectId,
    idempotencyKey: ProjectId,
    command: "'rename_project'",
    payload: { "+": "reject", title: text },
  },
  {
    "+": "reject",
    mutationId: ProjectId,
    idempotencyKey: ProjectId,
    command: "'version_project'",
    payload: { "+": "reject", sourceProjectId: ProjectId, title: text },
  },
);
export type ProjectMutation = typeof ProjectMutation.infer;
export const ProjectLifecycleStatus = type("'active' | 'archived'");
export type ProjectLifecycleStatus = typeof ProjectLifecycleStatus.infer;
export const ProjectView = type({
  "+": "reject",
  projectId: ProjectId,
  tenantId: "string > 0",
  title: text,
  status: ProjectLifecycleStatus,
  coordinatorRunId: "string | null",
  "versionOf?": { "+": "reject", projectId: ProjectId, title: text },
});
export type ProjectView = typeof ProjectView.infer;
export const ProjectMutationReceipt = type({
  "+": "reject",
  ok: "true",
  mutationId: ProjectId,
  projectId: ProjectId,
});

// Shipped is the person's mark; building means a coder run exists; anything else is an idea.
export const ProjectStage = type("'idea' | 'building' | 'shipped'");
export type ProjectStage = typeof ProjectStage.infer;

// Listing exposes lifecycle truth without plan bodies: a home page reads many
// projects, and each full plan read stays separately authorized and filtered.
export const ProjectSummary = type({
  "+": "reject",
  projectId: ProjectId,
  tenantId: "string > 0",
  title: text,
  status: ProjectLifecycleStatus,
  stage: ProjectStage,
  shippedAt: "string | null",
  coordinatorRunId: "string | null",
  createdAt: "string > 0",
  updatedAt: "string > 0",
  lastActivityAt: "string > 0",
});
export type ProjectSummary = typeof ProjectSummary.infer;
export const ProjectSummaryList = type({
  "+": "reject",
  projects: ProjectSummary.array(),
});
export type ProjectSummaryList = typeof ProjectSummaryList.infer;
export const ProjectLifecycleReceipt = type({
  "+": "reject",
  ok: "true",
  projectId: ProjectId,
  status: ProjectLifecycleStatus,
});
export type ProjectLifecycleReceipt = typeof ProjectLifecycleReceipt.infer;
export const ProjectShipReceipt = type({
  "+": "reject",
  ok: "true",
  projectId: ProjectId,
  shippedAt: "string | null",
});
export type ProjectShipReceipt = typeof ProjectShipReceipt.infer;

// A portable project: every filed document at its current version. approved
// says a person approved exactly that version; importing the file is the
// importing person's own approval of each document marked approved.
const ProjectExportDocument = ArtifactKindWrite.merge({
  "+": "reject",
  approved: "boolean",
});
// A file is filed as a base64 data: URL, as an uploaded one is, up to the bytes an upload takes per
// file (Interchange PER_ATTACHMENT_LIMIT_BYTES); a text material keeps a document's limit.
const MATERIAL_FILE_MAX_BYTES = 10 * 1024 * 1024;
const fileBytes = (content: string) => {
  const base64 = content.slice(content.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
};
const MaterialFile = type(/^data:[^,]*;base64,/).narrow(
  (content, ctx) =>
    fileBytes(content) <= MATERIAL_FILE_MAX_BYTES ||
    ctx.mustBe(`a file of at most ${MATERIAL_FILE_MAX_BYTES} bytes`),
);
export const MaterialContent = DocumentContent.or(MaterialFile);
// A document with no kind of its own, filed as a material under its title.
export const ProjectExportMaterial = ArtifactKindWrite.pick("title").merge({
  content: MaterialContent,
});
export type ProjectExportMaterial = typeof ProjectExportMaterial.infer;
export const ProjectExport = type({
  "+": "reject",
  format: "'corbits-builder.project'",
  version: "1",
  title: text,
  documents: ProjectExportDocument.array(),
  "materials?": ProjectExportMaterial.array(),
});
export type ProjectExport = typeof ProjectExport.infer;
// A project zip's parts: the planning documents and materials, the design with its options and
// mockups, and the built app.
export const ExportSection = type("'planning' | 'design' | 'build'");
export type ExportSection = typeof ExportSection.infer;
export const EXPORT_SECTIONS: readonly ExportSection[] = [
  "planning",
  "design",
  "build",
];
export function exportSection(kind: string): ExportSection {
  if (kind === "app") return "build";
  if (kind === "design" || kind === "design_option") return "design";
  return "planning";
}
export const ProjectImportReceipt = type({
  "+": "reject",
  projectId: ProjectId,
  "omitted?": "string[]",
});
export type ProjectImportReceipt = typeof ProjectImportReceipt.infer;
