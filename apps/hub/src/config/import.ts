// A change to code that exists starts at once, documents or not.
const DIRECT_CHANGE_MESSAGE =
  " The code is already built and filed as the app document, so a change I ask for can be made directly, with no documents to write or approve first.";

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

// The importing person's opening message to a newly imported project's coordinator. It names the
// imported documents with no kind of their own, so the coordinator reads them as the project's
// materials. When the app came in without some of its documents (a person's own repository), it
// names those and tells the coordinator to read the code to learn the app.
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
      ? ` The code came from my own repository, so it brought none of these documents: ${missing.join(", ")}. None is needed to change it; read the code with read_artifact, starting with its README and package.json, to learn what it is.`
      : "";
  return (
    IMPORTED_PROJECT_LEAD +
    filed +
    (withApp ? DIRECT_CHANGE_MESSAGE : "") +
    unwritten
  );
}
