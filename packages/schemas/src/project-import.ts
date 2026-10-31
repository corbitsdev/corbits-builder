import { type } from "arktype";
import { MaterialContent, ProjectExport } from "./project.ts";

// The original Corbits Solution Builder's project file (its apps/web/src/project-export.ts):
// the nine-stage artifact graph, stage mail and the workflow's accepted decisions. Only the
// fields the conversion reads are named; the rest of the file is ignored.
const OriginalProject = type({
  format: "'solutions-builder.project'",
  version: "2 | 3 | 4",
  project: { title: "string" },
  artifacts: type({
    node: {
      kind: "string",
      title: "string",
      version: "number",
      artifactId: "string",
      createdAt: "string",
      supersededByNodeId: "string | null",
    },
    content: "string",
  }).array(),
  "workflow?": {
    decisions: type({
      kind: "string",
      "artifactId?": "string",
      "version?": "number",
    }).array(),
  },
});
type OriginalProject = typeof OriginalProject.infer;

// The original's stage documents that have a Builder kind of the same meaning. Its design is one
// HTML or Markdown document, while a Builder design is the designer's bundle of DESIGN.md and
// designs/index.html, so it has no equivalent here and is carried as a material.
const CARRIED_KINDS = {
  problem_brief: "problem_brief",
  solution_constraints: "constraints",
  chosen_approach: "approaches",
  product_requirements: "product_requirements",
  build_plan: "build_plan",
} as const;

export type ProjectImport = { file: ProjectExport; omitted: string[] };

type OriginalDocument = OriginalProject["artifacts"][number];

const isCarried = (kind: string) => kind in CARRIED_KINDS;
// The original stores an uploaded file or a slide deck as a base64 data: URL. Its uploaded source
// files are carried as materials, as a file uploaded here is; its generated slide decks are not.
const isMaterial = ({ node, content }: OriginalDocument) =>
  !isCarried(node.kind) &&
  (!content.startsWith("data:") || node.kind === "source_material") &&
  MaterialContent.allows(content);

// Every current document of a kind with no Builder equivalent, each under a title of its own, since a
// material's title is its name and filing the same name again files that material's next version.
function originalMaterials(current: readonly OriginalDocument[]) {
  const titles = new Set<string>();
  return current.filter(isMaterial).map(({ node, content }) => {
    const base = node.title.trim() || node.kind;
    let title = base;
    for (let copy = 2; titles.has(title); copy++) title = `${base} (${copy})`;
    titles.add(title);
    return { title, content };
  });
}

function fromOriginal(
  original: OriginalProject,
  current: readonly OriginalDocument[],
): ProjectExport | type.errors {
  const approved = (artifactId: string, version: number) =>
    (original.workflow?.decisions ?? []).some(
      (decision) =>
        decision.kind === "approve" &&
        decision.artifactId === artifactId &&
        decision.version === version,
    );
  const documents = Object.entries(CARRIED_KINDS).flatMap(
    ([originalKind, kind]) => {
      const newest = current.find(({ node }) => node.kind === originalKind);
      return newest
        ? [
            {
              kind,
              title: newest.node.title,
              content: newest.content,
              approved: approved(newest.node.artifactId, newest.node.version),
            },
          ]
        : [];
    },
  );
  return ProjectExport({
    format: "corbits-builder.project",
    version: 1,
    title: original.project.title,
    documents,
    materials: originalMaterials(current),
  });
}

// A project file from this app or from the original Solution Builder, as this app's own format.
// The original's text documents and source files with no Builder kind are carried as materials; omitted
// names each kind with a document left out, a slide deck or one over a material's limit.
export function readProjectImport(input: unknown): ProjectImport | type.errors {
  const isOriginal =
    typeof input === "object" &&
    input !== null &&
    (input as { format?: unknown }).format === "solutions-builder.project";
  if (!isOriginal) {
    const file = ProjectExport(input);
    return file instanceof type.errors ? file : { file, omitted: [] };
  }
  const original = OriginalProject(input);
  if (original instanceof type.errors) return original;
  const current = original.artifacts
    .filter(({ node }) => node.supersededByNodeId === null)
    .sort((a, b) => b.node.createdAt.localeCompare(a.node.createdAt));
  const file = fromOriginal(original, current);
  if (file instanceof type.errors) return file;
  const omitted = new Set(
    current
      .filter(
        (document) => !isCarried(document.node.kind) && !isMaterial(document),
      )
      .map(({ node }) => node.kind),
  );
  return { file, omitted: [...omitted] };
}
