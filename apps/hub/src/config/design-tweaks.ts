// The hub's notes when the person saves look tweaks from the mockup's tweak panel. They reach each
// run as the person's message. A save is never an approval: the person may still redo the design.
const listed = (tokens: Readonly<Record<string, string>>) =>
  Object.entries(tokens)
    .map(([name, value]) => `--${name}: ${value}`)
    .join(", ");

export function coordinatorTweaksNote(
  tokens: Readonly<Record<string, string>>,
  updated: readonly ("workspace" | "version")[],
): string {
  const where = updated
    .map((place) =>
      place === "workspace"
        ? "the live designer's styles.css"
        : "a new version of the filed design's styles.css",
    )
    .join(" and ");
  return `The person saved look tweaks to the design in ${where}: ${listed(tokens)}. This is not an approval; nothing about the design is decided by it.`;
}

export function designerTweaksNote(
  tokens: Readonly<Record<string, string>>,
): string {
  return `The person changed these tokens in .builder/designs/styles.css: ${listed(tokens)}. Keep them unless they ask otherwise.`;
}
