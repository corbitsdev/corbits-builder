const IN_SHORT = /^##\s+In short\s*$/i;
const HEADING = /^#{1,6}\s/;

/** The `## In short` section a filed document opens with, as written, or undefined when it has none. */
export function inShort(content: string): string | undefined {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => IN_SHORT.test(line));
  if (start === -1) return undefined;
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => HEADING.test(line));
  const section = after
    .slice(0, end === -1 ? after.length : end)
    .join("\n")
    .trim();
  return section === "" ? undefined : section;
}
