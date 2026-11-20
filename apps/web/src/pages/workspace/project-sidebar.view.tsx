/**
 * An open project's sidebar: the project's name, which opens and closes it, then what the project
 * holds: the plan's steps and the project's files, as one tree, and the app's state. Kept at the
 * bottom, smaller and greyer, are the links that leave it: the project's settings and secrets, the
 * other projects, and the workspace's settings and the person's account. Closed, only the project's
 * name stays. Where the room is narrow it is a drawer over the page.
 */
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Building2,
  Check,
  ChevronRight,
  CircleUser,
  Ellipsis,
  Folder,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Printer,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  SidebarItem,
  StatusDot,
  TypingIndicator,
  type StatusDotTone,
} from "@corbits/react-ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { wording } from "../../config.ts";
import { DangerMenuItem, Mark } from "../../components.jsx";
import styles from "./project-sidebar.module.css";

const words = wording.projectShell;

// The platform's own modifier, so the shortcut, its announced keys and its title agree.
const mac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);
const shortcut = mac
  ? { key: "Meta+Backslash", words: words.shortcut.mac }
  : { key: "Control+Backslash", words: words.shortcut.other };

/** Where a step of the plan stands, as its row marks it. */
export type SidebarStepState =
  | "to_do"
  | "running"
  | "needs_you"
  | "done"
  | "failed"
  | "declined";

export type SidebarStep = {
  id: string;
  name: string;
  state: SidebarStepState;
  /** Builder asks before it starts the step; null once that can no longer change. */
  askFirst: boolean | null;
  /** The person declined the step; null where it cannot be declined. */
  declined: boolean | null;
};

/** A part of the plan; its name is a heading only when the plan has more than one. */
export type SidebarPlanGroup = {
  id: string;
  name: string;
  steps: readonly SidebarStep[];
};

/** Where a file stands, as its row marks it: one mark at most, none when it is ready. */
export type SidebarFileState =
  | "ready"
  | "needs_you"
  | "writing"
  | "drawing"
  | "failed";

export type SidebarFileRow = {
  id: string;
  name: string;
  state: SidebarFileState;
  /** A version the person has not looked at yet; a ready row shows the new-version dot. */
  newVersion: boolean;
};

export type SidebarFile = SidebarFileRow & {
  /** A written document, which its row's menu prints. */
  printable: boolean;
  /** An attached file, which its row's menu removes from the project. */
  removable: boolean;
  /** The rows under it, such as the design's mockup, its draft and its concepts. */
  parts: readonly SidebarFileRow[];
};

/** How the project's app stands, as the Live row says it. */
export type SidebarAppState =
  | "not_built"
  | "starting"
  | "running"
  | "stopped"
  | "failed";

export type ProjectSidebarViewProps = {
  project: string;
  /** Closed, only the project's name shows, to open it again. */
  open: boolean;
  /** The room is narrow, so the open sidebar lies over the page. */
  drawer: boolean;
  plan: readonly SidebarPlanGroup[];
  files: readonly SidebarFile[];
  /** The file or part on the page; its row is marked. */
  selectedFile: string | null;
  app: SidebarAppState;
  /** The app is on the page; the Live row is marked. */
  appOpen: boolean;
  onToggleSidebar: () => void;
  onOpenFile: (fileId: string) => void;
  onPrintFile: (fileId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onAskFirst: (stepId: string, askFirst: boolean) => void;
  onDecline: (stepId: string, declined: boolean) => void;
  onOpenApp: () => void;
  onProjectSettings: () => void;
  onSecrets: () => void;
  onAllProjects: () => void;
  onNewProject: () => void;
  onWorkspaceSettings: () => void;
  onAccount: () => void;
};

export function ProjectSidebarView({
  project,
  open,
  drawer,
  plan,
  files,
  selectedFile,
  app,
  appOpen,
  onToggleSidebar,
  onOpenFile,
  onPrintFile,
  onRemoveFile,
  onAskFirst,
  onDecline,
  onOpenApp,
  onProjectSettings,
  onSecrets,
  onAllProjects,
  onNewProject,
  onWorkspaceSettings,
  onAccount,
}: ProjectSidebarViewProps) {
  const bodyId = `project-sidebar-${useId()}`;
  // The last open or close came from the keyboard, so it happens without moving.
  const [byKey, setByKey] = useState(false);
  // The shortcut opens and closes the sidebar from anywhere in the project.
  const toggleByKey = useEffectEvent(onToggleSidebar);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "\\" || !(mac ? event.metaKey : event.ctrlKey)) return;
      event.preventDefault();
      setByKey(true);
      toggleByKey();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  // One root open or closed, so the toggle keeps focus as the sidebar opens and closes, and the
  // panel stays mounted so it can leave as well as arrive.
  return (
    <aside
      className={styles.sidebar}
      data-slot="project-sidebar"
      data-open={open ? "" : undefined}
      data-drawer={drawer ? "" : undefined}
      data-instant={byKey ? "" : undefined}
      aria-label={words.sidebar}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-keyshortcuts={shortcut.key}
        title={`${open ? words.closeSidebar : words.openSidebar} (${shortcut.words})`}
        onClick={() => {
          setByKey(false);
          onToggleSidebar();
        }}
      >
        <span className={styles.mark}>
          <Mark size={24} />
        </span>
        <span className={styles.project}>{project}</span>
        <Icon aria-hidden="true" />
      </button>
      <div className={styles.room}>
        <div id={bodyId} className={styles.panel} inert={!open}>
          <div className={styles.body}>
            <ProjectTree
              label={project}
              plan={plan}
              files={files}
              selectedFile={selectedFile}
              onOpenFile={onOpenFile}
              onPrintFile={onPrintFile}
              onRemoveFile={onRemoveFile}
              onAskFirst={onAskFirst}
              onDecline={onDecline}
            />
            <Live app={app} open={appOpen} onOpen={onOpenApp} />
            <div className={styles.utilities}>
              <Links label={words.groups.thisProject}>
                <Link icon={Settings} onClick={onProjectSettings}>
                  {words.projectSettings}
                </Link>
                <Link icon={Lock} onClick={onSecrets}>
                  {wording.settings.tab.secrets}
                </Link>
              </Links>
              <Links label={words.groups.projects}>
                <Link icon={Folder} onClick={onAllProjects}>
                  {words.allProjects}
                </Link>
                <Link icon={Plus} onClick={onNewProject}>
                  {wording.shell.newProject}
                </Link>
              </Links>
              <Links label={words.groups.workspace}>
                <Link icon={Building2} onClick={onWorkspaceSettings}>
                  {words.workspaceSettings}
                </Link>
                <Link icon={CircleUser} onClick={onAccount}>
                  {words.account}
                </Link>
              </Links>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** A few links that go together at the sidebar's foot, named for a screen reader. */
function Links({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.links} aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * The app's state, and Open app once there is an app to open. Its words change as the app starts,
 * runs or stops, so they are read out as they change.
 */
function Live({
  app,
  open,
  onOpen,
}: {
  app: SidebarAppState;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <div className={styles.live} data-current={open ? "" : undefined}>
      <span className={styles.liveName}>{words.live}</span>
      <span className={styles.note} data-state={app} aria-live="polite">
        {words.appState[app]}
      </span>
      {app === "not_built" ? null : (
        <Button type="button" variant="outline" size="sm" onClick={onOpen}>
          {words.openApp}
        </Button>
      )}
    </div>
  );
}

function Link({
  icon: Icon,
  onClick,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <SidebarItem
      asChild
      className={styles.link}
      icon={<Icon aria-hidden="true" />}
    >
      <button type="button" onClick={onClick}>
        {children}
      </button>
    </SidebarItem>
  );
}

const PLAN = "plan" as const;
const FILES = "files" as const;
type Branch = typeof PLAN | typeof FILES;

const stepKey = (stepId: string) => `step:${stepId}`;
const fileKey = (fileId: string) => `file:${fileId}`;

/** A row of the tree, whether or not a fold hides it. */
type TreeRow = {
  key: string;
  /** The row it sits under; null for Plan and Files. */
  parent: string | null;
  /** What a typed letter matches. */
  name: string;
  /** The branch it is, or sits in, which folds it away. */
  branch: Branch;
  /** What Enter or Space does on it. */
  activate: (() => void) | null;
  /** It has a menu, which Shift+F10 or the context-menu key opens. */
  menu: boolean;
};

/** What every row of the tree takes to hold the tree's one tab stop. */
type TreeItemProps = Required<
  Pick<ComponentProps<"li">, "ref" | "tabIndex" | "onFocus">
>;

/**
 * Plan and Files as one tree with a single tab stop, after the WAI-ARIA tree view pattern: the
 * arrows move between rows and fold Plan and Files, Home and End jump, a letter finds the next row
 * starting with it, Enter or Space opens a file, folds a branch or opens a step's menu, and
 * Shift+F10 or the context-menu key opens a row's menu. Folding and menus only change the look, so
 * they are held here.
 */
function ProjectTree({
  label,
  plan,
  files,
  selectedFile,
  onOpenFile,
  onPrintFile,
  onRemoveFile,
  onAskFirst,
  onDecline,
}: {
  label: string;
  plan: readonly SidebarPlanGroup[];
  files: readonly SidebarFile[];
  selectedFile: string | null;
  onOpenFile: (fileId: string) => void;
  onPrintFile: (fileId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onAskFirst: (stepId: string, askFirst: boolean) => void;
  onDecline: (stepId: string, declined: boolean) => void;
}) {
  // The row whose menu is open, and what to do once it has closed and handed focus back.
  const [menu, setMenu] = useState<string | null>(null);
  const afterMenu = useRef<(() => void) | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<Branch>>(new Set());
  const toggle = (branch: Branch) => {
    const next = new Set(folded);
    if (!next.delete(branch)) next.add(branch);
    setFolded(next);
  };
  const steps = plan.flatMap((group) => group.steps);
  const folds = { [PLAN]: steps.length > 0, [FILES]: files.length > 0 };
  const branchRow = (branch: Branch, name: string): TreeRow => ({
    key: branch,
    parent: null,
    name,
    branch,
    activate: folds[branch] ? () => toggle(branch) : null,
    menu: false,
  });
  const allRows: TreeRow[] = [
    branchRow(PLAN, words.plan),
    ...steps.map((step): TreeRow => {
      const key = stepKey(step.id);
      const menu = stepHasMenu(step);
      return {
        key,
        parent: PLAN,
        name: step.name,
        branch: PLAN,
        activate: menu ? () => setMenu(key) : null,
        menu,
      };
    }),
    branchRow(FILES, words.files),
    ...files.flatMap((file) =>
      [file, ...file.parts].map((row): TreeRow => ({
        key: fileKey(row.id),
        parent: row === file ? FILES : fileKey(file.id),
        name: row.name,
        branch: FILES,
        activate: () => onOpenFile(row.id),
        menu: row === file && fileHasMenu(file),
      })),
    ),
  ];
  const rows = allRows.filter(
    (row) => row.parent === null || !folded.has(row.branch),
  );
  const items = useRef(new Map<string, HTMLElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // A fold from the keyboard happens at once; one from the pointer slides.
  const [byKey, setByKey] = useState(false);
  // A row folded away hands its place to its branch.
  const placeOf = (key: string | null) => {
    const row = allRows.find((each) => each.key === key);
    if (row === undefined) return undefined;
    return rows.includes(row) ? row.key : row.branch;
  };
  // Tab enters at the row last focused, else the open file, else the first row.
  const tabStop =
    placeOf(focused) ??
    placeOf(selectedFile === null ? null : fileKey(selectedFile)) ??
    rows[0]?.key ??
    null;
  const focus = (key: string) => {
    setFocused(key);
    items.current.get(key)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // A row's menu is drawn elsewhere on the page, but its keys still pass through here.
    if (
      event.target instanceof Node &&
      !event.currentTarget.contains(event.target)
    )
      return;
    // The row the key was pressed on, which is the tab stop unless focus got there unannounced.
    const on =
      [...items.current].find(([, element]) => element === event.target)?.[0] ??
      tabStop;
    const index = rows.findIndex((row) => row.key === on);
    const row = rows[index];
    if (row === undefined || event.altKey || event.metaKey || event.ctrlKey)
      return;
    const branch = row.parent === null && folds[row.branch] ? row.branch : null;
    const move = (to: TreeRow | undefined) => {
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
        if (branch !== null && folded.has(branch)) toggle(branch);
        else if (branch !== null) move(rows[index + 1]);
        else if (rows[index + 1]?.parent === row.key) move(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (branch !== null && !folded.has(branch)) toggle(branch);
        else if (row.parent !== null) focus(row.parent);
        break;
      case "Enter":
      case " ":
        row.activate?.();
        break;
      case "ContextMenu":
        if (row.menu) setMenu(row.key);
        break;
      case "F10":
        if (!event.shiftKey) return;
        if (row.menu) setMenu(row.key);
        break;
      default: {
        if (event.key.length !== 1 || event.key === " ") return;
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
    setByKey(true);
  };
  const itemProps = (key: string): TreeItemProps => ({
    ref: (element) => {
      if (element === null) items.current.delete(key);
      else items.current.set(key, element);
    },
    tabIndex: key === tabStop ? 0 : -1,
    onFocus: (event) => {
      if (event.target === event.currentTarget) setFocused(key);
    },
  });
  const menuOf = (key: string, name: string): RowMenuProps => ({
    label: words.rowMenu(name),
    open: menu === key,
    onOpenChange: (open) => setMenu(open ? key : null),
    onClosed: () => {
      focus(key);
      const then = afterMenu.current;
      afterMenu.current = null;
      then?.();
    },
  });
  const many = plan.length > 1;
  const headings = useId();
  return (
    <ul
      role="tree"
      aria-label={label}
      className={styles.tree}
      data-keyboard={byKey ? "" : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={() => setByKey(false)}
    >
      <BranchItem
        name={words.plan}
        empty={words.noPlan}
        open={folds[PLAN] ? !folded.has(PLAN) : null}
        onToggle={() => toggle(PLAN)}
        {...itemProps(PLAN)}
      >
        {plan.map((group, index) => {
          const headingId = `${headings}-${String(index)}`;
          return (
            <ul
              key={group.id}
              role="group"
              className={styles.rows}
              aria-labelledby={many ? headingId : undefined}
            >
              {many ? (
                <li role="none" id={headingId} className={styles.heading}>
                  {group.name}
                </li>
              ) : null}
              {group.steps.map((step) => (
                <StepItem
                  key={step.id}
                  step={step}
                  menu={
                    stepHasMenu(step) ? (
                      <StepMenu
                        step={step}
                        menu={menuOf(stepKey(step.id), step.name)}
                        onAskFirst={(askFirst) => onAskFirst(step.id, askFirst)}
                        onDecline={(declined) => onDecline(step.id, declined)}
                      />
                    ) : null
                  }
                  {...itemProps(stepKey(step.id))}
                />
              ))}
            </ul>
          );
        })}
      </BranchItem>
      <BranchItem
        name={words.files}
        empty={words.noFiles}
        open={folds[FILES] ? !folded.has(FILES) : null}
        onToggle={() => toggle(FILES)}
        {...itemProps(FILES)}
      >
        <ul role="group" className={styles.rows}>
          {files.map((file) => (
            <FileItem
              key={file.id}
              row={file}
              level={2}
              selected={file.id === selectedFile}
              onOpen={() => onOpenFile(file.id)}
              menu={
                fileHasMenu(file) ? (
                  <FileMenu
                    file={file}
                    menu={menuOf(fileKey(file.id), file.name)}
                    // Printed once the menu has gone, so the menu is not printed with it.
                    onPrint={() => {
                      afterMenu.current = () => onPrintFile(file.id);
                    }}
                    onRemove={() => onRemoveFile(file.id)}
                  />
                ) : null
              }
              {...itemProps(fileKey(file.id))}
            >
              {file.parts.length === 0 ? null : (
                <ul role="group" className={styles.parts}>
                  {file.parts.map((part) => (
                    <FileItem
                      key={part.id}
                      row={part}
                      level={3}
                      selected={part.id === selectedFile}
                      onOpen={() => onOpenFile(part.id)}
                      {...itemProps(fileKey(part.id))}
                    />
                  ))}
                </ul>
              )}
            </FileItem>
          ))}
        </ul>
      </BranchItem>
    </ul>
  );
}

/**
 * Plan or Files: a row that folds what it lists, or, while it lists nothing, says so and does
 * nothing. `open` is null while there is nothing to fold.
 */
function BranchItem({
  name,
  empty,
  open,
  onToggle,
  children,
  ...item
}: {
  name: string;
  empty: string;
  open: boolean | null;
  onToggle: () => void;
  children: ReactNode;
} & TreeItemProps) {
  if (open === null)
    return (
      <li
        role="treeitem"
        aria-level={1}
        aria-label={`${name}, ${empty}`}
        className={styles.item}
        {...item}
      >
        <span className={styles.row} data-row="branch" data-empty="">
          <span className={styles.name}>{name}</span>
          <span className={styles.note}>{empty}</span>
        </span>
      </li>
    );
  return (
    <li
      role="treeitem"
      aria-level={1}
      aria-expanded={open}
      aria-label={name}
      className={styles.item}
      data-open={open ? "" : undefined}
      {...item}
    >
      <span className={styles.row} data-row="branch" onClick={onToggle}>
        <span className={styles.name}>{name}</span>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
      </span>
      <div className={styles.fold}>
        <div className={styles.folded}>{children}</div>
      </div>
    </li>
  );
}

// The row's name already says the state, so its mark carries no words of its own.
const stepTone: Partial<Record<SidebarStepState, StatusDotTone>> = {
  needs_you: "emphasis",
  failed: "danger",
};

function StepItem({
  step,
  menu,
  ...item
}: { step: SidebarStep; menu: ReactNode } & TreeItemProps) {
  const { state } = step;
  const tone = stepTone[state];
  return (
    <li
      role="treeitem"
      aria-level={2}
      aria-haspopup={menu === null ? undefined : "menu"}
      aria-label={`${step.name}, ${words.stepState[state]}`}
      className={styles.item}
      title={step.name}
      {...item}
    >
      <span className={styles.row} data-row="step" data-state={state}>
        <span className={styles.name}>{step.name}</span>
        {state === "running" ? (
          <span className={styles.writing} aria-hidden="true">
            <TypingIndicator label={words.stepState.running} />
          </span>
        ) : state === "done" ? (
          <Check className={styles.done} aria-hidden="true" />
        ) : tone === undefined ? null : (
          <StatusDot label="" size="xs" tone={tone} />
        )}
        {menu}
      </span>
    </li>
  );
}

const fileTone: Partial<Record<SidebarFileState, StatusDotTone>> = {
  needs_you: "emphasis",
  failed: "danger",
};

function FileItem({
  row,
  level,
  selected,
  onOpen,
  menu = null,
  children,
  ...item
}: {
  row: SidebarFileRow;
  level: 2 | 3;
  selected: boolean;
  onOpen: () => void;
  menu?: ReactNode;
  children?: ReactNode;
} & TreeItemProps) {
  const { state } = row;
  // The new-version dot shows only on a ready row; any other mark says more.
  const fresh = state === "ready" && row.newVersion && !selected;
  const said =
    state !== "ready"
      ? words.fileState[state]
      : fresh
        ? wording.documentUnread
        : null;
  const tone = fresh ? "emphasis" : fileTone[state];
  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-current={selected ? "page" : undefined}
      aria-haspopup={menu === null ? undefined : "menu"}
      aria-label={said === null ? row.name : `${row.name}, ${said}`}
      className={styles.item}
      title={row.name}
      {...item}
    >
      <span
        className={styles.row}
        data-row="file"
        data-state={state}
        onClick={(event) => {
          // A click in the row's menu, drawn elsewhere on the page, still passes through here.
          if (
            event.target instanceof Node &&
            event.currentTarget.contains(event.target)
          )
            onOpen();
        }}
      >
        <span className={styles.name}>{row.name}</span>
        {state === "writing" || state === "drawing" ? (
          <span className={styles.writing} aria-hidden="true">
            <TypingIndicator label={words.fileState[state]} />
          </span>
        ) : tone === undefined ? null : (
          <StatusDot label="" size="xs" tone={tone} />
        )}
        {menu}
      </span>
      {children}
    </li>
  );
}

const stepHasMenu = (step: SidebarStep) =>
  step.askFirst !== null || step.declined !== null;

const fileHasMenu = (file: SidebarFile) => file.printable || file.removable;

type RowMenuProps = {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The menu has closed, by a choice or by Escape. */
  onClosed: () => void;
};

/**
 * A row's menu, from its button or the keyboard. The button is for the pointer only: the row
 * itself holds focus and says it has a menu, which Shift+F10 opens.
 */
function RowMenu({
  label,
  open,
  onOpenChange,
  onClosed,
  children,
}: RowMenuProps & { children: ReactNode }) {
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <button
          type="button"
          className={styles.more}
          tabIndex={-1}
          aria-hidden="true"
          title={label}
          onClick={(event) => event.stopPropagation()}
        >
          <Ellipsis />
        </button>
      </MenuTrigger>
      <MenuContent
        align="start"
        aria-label={label}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        {children}
      </MenuContent>
    </Menu>
  );
}

/** A setting in a row's menu, ticked while it is on. */
function CheckItem({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <MenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      onSelect={onSelect}
    >
      <Check
        className={styles.tick}
        data-checked={checked ? "" : undefined}
        aria-hidden="true"
      />
      {children}
    </MenuItem>
  );
}

function StepMenu({
  step,
  menu,
  onAskFirst,
  onDecline,
}: {
  step: SidebarStep;
  menu: RowMenuProps;
  onAskFirst: (askFirst: boolean) => void;
  onDecline: (declined: boolean) => void;
}) {
  const { askFirst, declined } = step;
  return (
    <RowMenu {...menu}>
      {askFirst === null ? null : (
        <CheckItem checked={askFirst} onSelect={() => onAskFirst(!askFirst)}>
          {wording.conversation.plan.askFirst}
        </CheckItem>
      )}
      {declined === null ? null : (
        <CheckItem checked={declined} onSelect={() => onDecline(!declined)}>
          {words.decline}
        </CheckItem>
      )}
    </RowMenu>
  );
}

/** Print for a written document; Remove from project for an attached file, which asks first. */
function FileMenu({
  file,
  menu,
  onPrint,
  onRemove,
}: {
  file: SidebarFile;
  menu: RowMenuProps;
  onPrint: () => void;
  onRemove: () => void;
}) {
  // Removing takes two choices, both in the menu: the second only exists after the first.
  const [confirming, setConfirming] = useState(false);
  return (
    <RowMenu
      {...menu}
      onOpenChange={(open) => {
        setConfirming(false);
        menu.onOpenChange(open);
      }}
    >
      {file.printable ? (
        <MenuItem onSelect={onPrint}>
          <Printer size={16} aria-hidden="true" />
          {wording.printDocument}
        </MenuItem>
      ) : null}
      {!file.removable ? null : confirming ? (
        <DangerMenuItem onSelect={onRemove}>
          <Trash2 size={16} aria-hidden="true" />
          {wording.removeAttachment.confirm}
        </DangerMenuItem>
      ) : (
        <DangerMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setConfirming(true);
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
          {words.removeFromProject}
        </DangerMenuItem>
      )}
    </RowMenu>
  );
}
