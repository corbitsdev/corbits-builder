const IMPORT_APP_MESSAGE =
  " The app is already built: its source is filed as the app document, and a coder starts from it, so assign only the work that remains.";

export const IMPORTED_PROJECT_LEAD =
  "I just imported this project from a file. Acknowledge the import, then tell me in a few plain sentences what the imported documents establish and what happens next.";

// The documents a project has before its app, in Builder's order.
export const PLANNED_DOCUMENT_KINDS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "design",
  "build_plan",
] as const;

// The importing person's opening message to a newly imported project's coordinator, naming the
// imported documents with no kind of their own so it reads them as the project's materials, and,
// when the app came in without some of its documents (a person's own repository), which ones
// the coordinator writes with them from the code.
export function importedProjectMessage(
  materials: readonly string[],
  withApp: boolean,
  missing: readonly string[] = [],
): string {
  const filed = materials.length
    ? ` The documents with no place of their own here are filed as materials: ${materials.join(", ")}.`
    : "";
  const unwritten =
    withApp && missing.length
      ? ` The code came from my own repository, so these documents were never written: ${missing.join(", ")}. Read the code with read_artifact, its package.json and README first, and write the brief yourself from what it shows, asking me only what the code cannot tell you; then have the writers produce the rest in order, each instruction carrying what you learned from the code, and have me approve each one before the next.`
      : "";
  return (
    IMPORTED_PROJECT_LEAD +
    filed +
    (withApp ? IMPORT_APP_MESSAGE : "") +
    unwritten
  );
}
