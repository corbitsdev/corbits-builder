import { EXCLUDED_DIRECTORIES } from "@corbits-builder/schemas/app-files";
import {
  readRepository,
  type RepositoryFile,
  type RepositoryImport,
} from "@corbits-builder/schemas/repository-import";

/** A folder the person picked: its name and its files, read lazily. */
export type PickedDirectory = { name: string; files: RepositoryFile[] };

// The File System Access API, which the DOM typings leave out: Chromium's folder picker hands
// over a handle the page walks itself, so node_modules and .git are never listed.
type FileHandle = { kind: "file"; name: string; getFile(): Promise<File> };
type DirectoryHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
};
type DirectoryPicker = (options: { mode: "read" }) => Promise<DirectoryHandle>;

const directoryPicker = () =>
  (window as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

/** Whether the browser has a folder picker; otherwise a folder input lists the files. */
export const canPickDirectory = () => directoryPicker() !== undefined;

const lazily = (file: File, path: string): RepositoryFile => ({
  path,
  size: file.size,
  bytes: async () => new Uint8Array(await file.arrayBuffer()),
});

async function walk(
  handle: DirectoryHandle,
  prefix: string,
): Promise<RepositoryFile[]> {
  const files: RepositoryFile[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      if (!EXCLUDED_DIRECTORIES.has(entry.name))
        files.push(...(await walk(entry, `${prefix}${entry.name}/`)));
    } else files.push(lazily(await entry.getFile(), prefix + entry.name));
  }
  return files;
}

/** Opens the folder picker; undefined when the person closes it without choosing. */
export async function pickDirectory(): Promise<PickedDirectory | undefined> {
  const picker = directoryPicker();
  if (!picker) return undefined;
  try {
    const handle = await picker({ mode: "read" });
    return { name: handle.name, files: await walk(handle, "") };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      return undefined;
    throw cause;
  }
}

/** What a folder input lists: each file under the chosen folder's name. */
export type ListedFile = {
  name: string;
  size: number;
  webkitRelativePath: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/**
 * The files a folder input lists, with the chosen folder's name taken off each path and the
 * directories the app never keeps left out.
 */
export function listedDirectory(
  listed: Iterable<ListedFile>,
): PickedDirectory | undefined {
  let name: string | undefined;
  const files: RepositoryFile[] = [];
  for (const file of listed) {
    const parts = file.webkitRelativePath.split("/");
    name ??= parts[0];
    const path = parts.slice(1);
    if (path.length === 0) continue;
    if (path.some((part) => EXCLUDED_DIRECTORIES.has(part))) continue;
    files.push(lazily(file as unknown as File, path.join("/")));
  }
  return name === undefined ? undefined : { name, files };
}

/** Reads a picked folder as a project, leaving out the paths the person unticked. */
export const readDirectory = (
  picked: PickedDirectory,
  exclude: ReadonlySet<string>,
): Promise<RepositoryImport> =>
  readRepository(picked.files, { name: picked.name, exclude });

/** A size as a person reads it. */
export function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
