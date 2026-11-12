// A change to an app that exists goes to a coder at once, documents or not.
const DIRECT_CHANGE_MESSAGE =
  " The app is already built: its source is filed as the app document, and it can be changed directly: a change I ask for goes to a coder at once, with no documents to write or approve first.";

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
// the coordinator reads the code to learn the app.
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
      ? ` The code came from my own repository, so these documents were never written: ${missing.join(", ")}. Read the code with read_artifact, its package.json and README to learn the app.`
      : "";
  return (
    IMPORTED_PROJECT_LEAD +
    filed +
    (withApp ? DIRECT_CHANGE_MESSAGE : "") +
    unwritten
  );
}
