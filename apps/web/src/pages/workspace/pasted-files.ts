/**
 * Files pasted into the message box, named so each can be attached: a picture from the clipboard
 * arrives as "image.png" every time, which the attachment list would refuse as a duplicate.
 */
const GENERIC_NAMES = new Set([
  "",
  "image.png",
  "image.jpg",
  "image.jpeg",
  "image.gif",
  "image.webp",
]);

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
};

/** "pasted-2026-11-04-10-52-07.png": a name a person can tell apart from the last paste. */
export function pastedName(type: string, at: Date): string {
  const stamp = at
    .toISOString()
    .slice(0, 19)
    .replace("T", "-")
    .replaceAll(":", "-");
  const extension = EXTENSIONS[type];
  return extension === undefined
    ? `pasted-${stamp}`
    : `pasted-${stamp}.${extension}`;
}

/** The files on the clipboard, each with a name of its own; empty when the paste is text. */
export function pastedFiles(
  clipboard: { files: ArrayLike<File> } | null,
  at: Date = new Date(),
): File[] {
  if (clipboard === null) return [];
  return Array.from(clipboard.files, (file, index) => {
    if (!GENERIC_NAMES.has(file.name.toLowerCase())) return file;
    const stamp = new Date(at.getTime() + index * 1000);
    return new File([file], pastedName(file.type, stamp), { type: file.type });
  });
}
