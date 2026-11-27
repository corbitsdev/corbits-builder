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

// Counts up for the page's life, so two pastes in one second still get different names.
let pasted = 0;

/** "pasted-2026-11-04-10-52-07-3.png": the time for the person, the count so no two collide. */
export function pastedName(type: string, at: Date, serial: number): string {
  const stamp = at
    .toISOString()
    .slice(0, 19)
    .replace("T", "-")
    .replaceAll(":", "-");
  const extension = EXTENSIONS[type];
  const base = `pasted-${stamp}-${String(serial)}`;
  return extension === undefined ? base : `${base}.${extension}`;
}

/**
 * The files on the clipboard, each with a name of its own, or none when the paste carries text:
 * an office app copies a picture of the cells beside the text, and the text is what was meant.
 */
export function pastedFiles(
  clipboard: { files: ArrayLike<File>; getData(type: string): string } | null,
  at: Date = new Date(),
): File[] {
  if (clipboard === null) return [];
  if (clipboard.getData("text/plain").trim() !== "") return [];
  return Array.from(clipboard.files, (file) => {
    if (!GENERIC_NAMES.has(file.name.toLowerCase())) return file;
    pasted += 1;
    return new File([file], pastedName(file.type, at, pasted), {
      type: file.type,
    });
  });
}
