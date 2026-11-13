const HEADING = /^#{1,6}\s/;

/** The text under a filed document's `## <title>` heading, as written, or undefined when it has none. */
export function documentSection(
  content: string,
  title: string,
): string | undefined {
  const opens = new RegExp(`^##\\s+${title}\\s*$`, "i");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => opens.test(line));
  if (start === -1) return undefined;
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => HEADING.test(line));
  const section = after
    .slice(0, end === -1 ? after.length : end)
    .join("\n")
    .trim();
  return section === "" ? undefined : section;
}

/** The `## In short` section a filed document opens with, as written, or undefined when it has none. */
export const inShort = (content: string) =>
  documentSection(content, "In short");
