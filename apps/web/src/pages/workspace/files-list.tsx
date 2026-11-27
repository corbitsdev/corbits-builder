/**
 * The project's files under a heading that folds them, as a compact file tree: a folder leads with a
 * chevron that folds it, a file beside one leaves that space empty so names line up, and what a
 * folder holds stands 1rem in. With no folder in the list, the rows drop that space, so the icons
 * line up with the heading. Where the list is taller than its room it scrolls inside itself. It is a tree with a single tab stop, after the
 * WAI-ARIA tree view pattern: up and down move between rows, right and left open and fold a row that
 * holds others and step into and out of it, Home and End jump, a letter finds the next row starting
 * with it, and Enter or Space opens a file or folds a folder. Folding only changes the look, so it is
 * held here.
 */
import {
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { wording } from "../../config.ts";
import rowStyles from "./sidebar-row.module.css";
import styles from "./files-list.module.css";

const words = wording.projectShell;

/**
 * One of the project's files, named for what it is. Only a row that groups others holds any: an
 * uploaded folder its files, or the designs where there are many.
 */
export type SidebarFile = {
  id: string;
  name: string;
  /** The tab the row opens; null for a folder, which only holds its files. */
  opens: string | null;
  files: readonly SidebarFile[];
};

export type FilesListProps = {
  files: readonly SidebarFile[];
  /** The tab opened from the files, whose row is marked; null while none is. */
  shown: string | null;
  onOpen: (tab: string) => void;
  /** A small folder or file icon before each name. */
  icons?: boolean | undefined;
};

/** A row as the keys move through it: only the rows a fold does not hide. */
type KeyRow = {
  key: string;
  /** What a typed letter matches. */
  name: string;
  /** What Enter or Space does on it. */
  activate: (() => void) | null;
  /** The row it sits under; null at the top. */
  parent: string | null;
  /** Whether what it holds shows; null for a row that holds nothing. */
  expanded: boolean | null;
};

/** What every row takes to hold the tree's one tab stop. */
type ItemProps = Required<
  Pick<ComponentProps<"li">, "ref" | "tabIndex" | "onFocus">
>;

const fileKey = (fileId: string) => `file:${fileId}`;
// Past this many files the group starts folded, so the plan above keeps the eye.
const MANY_FILES = 6;

const countFiles = (files: readonly SidebarFile[]): number =>
  files.reduce(
    (sum, file) => sum + (file.opens === null ? 0 : 1) + countFiles(file.files),
    0,
  );

// Each level stands 1rem further in than the row that holds it.
const indent = (level: number) =>
  `calc(var(--space-2) + ${String(level - 1)}rem)`;

export function FilesList({
  files,
  shown,
  onOpen,
  // The product owner first asked for no icons and may turn them off again here.
  icons = true,
}: FilesListProps) {
  const treeId = `files-${useId()}`;
  const [open, setOpen] = useState(() => countFiles(files) <= MANY_FILES);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const fold = (key: string) => {
    const next = new Set(folded);
    if (!next.delete(key)) next.add(key);
    setFolded(next);
  };
  // A file opens on its tab; a folder, which has none, folds.
  const activate = (file: SidebarFile) => {
    const { opens } = file;
    if (opens !== null) return () => onOpen(opens);
    return file.files.length > 0 ? () => fold(fileKey(file.id)) : null;
  };
  const rows: KeyRow[] = [];
  const list = (level: readonly SidebarFile[], parent: string | null) => {
    for (const file of level) {
      const key = fileKey(file.id);
      const expanded = file.files.length === 0 ? null : !folded.has(key);
      rows.push({
        key,
        name: file.name,
        activate: activate(file),
        parent,
        expanded,
      });
      if (expanded === true) list(file.files, key);
    }
  };
  list(files, null);
  const items = useRef(new Map<string, HTMLElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // Tab enters at the row last focused, else the first.
  const tabStop =
    focused !== null && rows.some((row) => row.key === focused)
      ? focused
      : rows[0]?.key;
  const focus = (key: string) => {
    setFocused(key);
    items.current.get(key)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // The row the key was pressed on, which is the tab stop unless focus got there unannounced.
    const on =
      [...items.current].find(([, element]) => element === event.target)?.[0] ??
      tabStop;
    const index = rows.findIndex((row) => row.key === on);
    const row = rows[index];
    if (row === undefined || event.altKey || event.metaKey || event.ctrlKey)
      return;
    const move = (to: KeyRow | undefined) => {
      if (to !== undefined) focus(to.key);
    };
    switch (event.key) {
      case "ArrowDown":
        move(rows[index + 1]);
        break;
      case "ArrowUp":
        move(rows[index - 1]);
        break;
      case "Home":
        move(rows[0]);
        break;
      case "End":
        move(rows.at(-1));
        break;
      case "ArrowRight":
        if (row.expanded === false) fold(row.key);
        else if (row.expanded === true) move(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (row.expanded === true) fold(row.key);
        else if (row.parent !== null) focus(row.parent);
        break;
      case "Enter":
      case " ":
        row.activate?.();
        break;
      default: {
        if (event.key.length !== 1) return;
        const letter = event.key.toLowerCase();
        const after = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
        const found = after.find((each) =>
          each.name.toLowerCase().startsWith(letter),
        );
        if (found === undefined) return;
        focus(found.key);
      }
    }
    event.preventDefault();
  };
  const itemProps = (key: string): ItemProps => ({
    ref: (element) => {
      if (element === null) items.current.delete(key);
      else items.current.set(key, element);
    },
    tabIndex: key === tabStop ? 0 : -1,
    onFocus: (event) => {
      if (event.target === event.currentTarget) setFocused(key);
    },
  });
  // Until the project has a file there is no group to fold.
  if (files.length === 0) return null;
  const chevrons = files.some((file) => file.files.length > 0);
  return (
    <section className={styles.files}>
      <h2 className={styles.head}>
        <button
          type="button"
          className={styles.fold}
          aria-expanded={open}
          aria-controls={treeId}
          onClick={() => setOpen(!open)}
        >
          {words.files}
          <ChevronRight className={styles.arrow} aria-hidden="true" />
        </button>
      </h2>
      <ul
        id={treeId}
        role="tree"
        aria-label={words.files}
        className={styles.tree}
        hidden={!open}
        onKeyDown={onKeyDown}
      >
        {files.map((file) => (
          <FileItem
            key={file.id}
            file={file}
            level={1}
            chevrons={chevrons}
            folded={folded}
            shown={shown}
            icons={icons}
            activate={activate}
            onFold={fold}
            itemProps={itemProps}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One file, and what it holds one level in. The one on the page has a faint fill.
 */
function FileItem({
  file,
  level,
  chevrons,
  folded,
  shown,
  icons,
  activate,
  onFold,
  itemProps,
}: {
  file: SidebarFile;
  level: number;
  /** Some row in the list holds others, so every row leaves room for a chevron. */
  chevrons: boolean;
  folded: ReadonlySet<string>;
  shown: string | null;
  icons: boolean;
  activate: (file: SidebarFile) => (() => void) | null;
  onFold: (key: string) => void;
  itemProps: (key: string) => ItemProps;
}) {
  const key = fileKey(file.id);
  const holds = file.files.length > 0;
  const expanded = holds && !folded.has(key);
  const onActivate = activate(file);
  const Icon = holds ? Folder : File;
  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-expanded={holds ? expanded : undefined}
      // Named for itself alone, not for the files it holds.
      aria-label={file.name}
      aria-current={
        file.opens !== null && file.opens === shown ? "page" : undefined
      }
      className={styles.file}
      {...itemProps(key)}
    >
      <span
        className={styles.row}
        data-opens={onActivate === null ? undefined : ""}
        style={{ paddingInlineStart: indent(level) }}
        title={file.name}
        onClick={onActivate ?? undefined}
      >
        {chevrons ? (
          <span
            className={styles.arrowBox}
            onClick={
              holds
                ? (event) => {
                    event.stopPropagation();
                    onFold(key);
                  }
                : undefined
            }
          >
            {holds ? (
              <ChevronRight className={styles.arrow} aria-hidden="true" />
            ) : null}
          </span>
        ) : null}
        {icons ? <Icon className={styles.icon} aria-hidden="true" /> : null}
        <span className={rowStyles.name}>{file.name}</span>
      </span>
      {expanded ? (
        <ul role="group" className={styles.tree}>
          {file.files.map((child) => (
            <FileItem
              key={child.id}
              file={child}
              level={level + 1}
              chevrons={chevrons}
              folded={folded}
              shown={shown}
              icons={icons}
              activate={activate}
              onFold={onFold}
              itemProps={itemProps}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
