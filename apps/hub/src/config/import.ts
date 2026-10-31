const IMPORT_APP_MESSAGE =
  " The app is already built: its source is filed as the app document, and a coder starts from it, so assign only the work that remains.";

export const IMPORTED_PROJECT_LEAD =
  "I just imported this project from a file. Acknowledge the import, then tell me in a few plain sentences what the imported documents establish and what happens next.";

// The importing person's opening message to a newly imported project's coordinator, naming the
// imported documents with no kind of their own so it reads them as the project's materials.
export function importedProjectMessage(
  materials: readonly string[],
  withApp: boolean,
): string {
  const filed = materials.length
    ? ` The documents with no place of their own here are filed as materials: ${materials.join(", ")}.`
    : "";
  return IMPORTED_PROJECT_LEAD + filed + (withApp ? IMPORT_APP_MESSAGE : "");
}
