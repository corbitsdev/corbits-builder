/**
 * An open project's sidebar: the project's name, which opens and closes it, then the plan's steps
 * and a line saying how the app stands, which opens it. Kept at the bottom, smaller and greyer, are
 * the links that leave it: the project's settings and secrets, the other projects, and the
 * workspace's settings and the person's account. Closed, only the project's name stays. Where the
 * room is narrow it is a drawer over the page. Its frame, foot and links are the workspace
 * sidebar's too, outside a project.
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
  ArrowUpRight,
  Building2,
  ChevronRight,
  CircleUser,
  Ellipsis,
  Folder,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { SidebarItem } from "@corbits/react-ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { wording } from "../../config.ts";
import { Mark } from "../../components.jsx";
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

/**
 * One thing the project makes, as the plan lists it: a document, the app, or what a ready-made
 * plan ends in. It covers the steps taken to make it, whose settings its menu changes.
 */
export type SidebarRow = {
  id: string;
  name: string;
  state: SidebarStepState;
  /** What it is at, under its name, when the name alone does not say; null otherwise. */
  doing: string | null;
  /** It makes the project's app: once built it opens the app and says how it runs. */
  app: boolean;
  /** The tab of what it made, which the row opens; null while there is nothing to show. */
  opens: string | null;
  steps: readonly SidebarStep[];
};

/** How the project's app stands, as its line says it. */
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
  plan: readonly SidebarRow[];
  app: SidebarAppState;
  /** The app is on the page; its line is marked. */
  appOpen: boolean;
  /** The tab on the page, whose step is marked; null while the chat fills the room. */
  shown: string | null;
  onToggleSidebar: () => void;
  onAskFirst: (stepId: string, askFirst: boolean) => void;
  onDecline: (stepId: string, declined: boolean) => void;
  onOpenApp: () => void;
  /** Opens what a step made, on its tab. */
  onOpenStep: (tab: string) => void;
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
  app,
  appOpen,
  shown,
  onToggleSidebar,
  onAskFirst,
  onDecline,
  onOpenApp,
  onOpenStep,
  onProjectSettings,
  onSecrets,
  onAllProjects,
  onNewProject,
  onWorkspaceSettings,
  onAccount,
}: ProjectSidebarViewProps) {
  return (
    <SidebarFrame
      title={project}
      open={open}
      drawer={drawer}
      onToggleSidebar={onToggleSidebar}
    >
      <PlanTree
        label={project}
        plan={plan}
        app={app}
        shown={shown}
        onAskFirst={onAskFirst}
        onDecline={onDecline}
        onOpenStep={onOpenStep}
      />
      {/* The app has its own line only where no row of the plan makes it. */}
      {plan.some((row) => row.app) ? null : (
        <AppLine app={app} open={appOpen} onOpen={onOpenApp} />
      )}
      <SidebarFoot>
        <SidebarLinks label={words.groups.thisProject}>
          <SidebarLink icon={Settings} onClick={onProjectSettings}>
            {words.projectSettings}
          </SidebarLink>
          <SidebarLink icon={Lock} onClick={onSecrets}>
            {wording.settings.tab.secrets}
          </SidebarLink>
        </SidebarLinks>
        <SidebarLinks label={words.groups.projects}>
          <SidebarLink icon={Folder} onClick={onAllProjects}>
            {words.allProjects}
          </SidebarLink>
          <SidebarLink icon={Plus} onClick={onNewProject}>
            {wording.shell.newProject}
          </SidebarLink>
        </SidebarLinks>
        <SidebarLinks label={words.groups.workspace}>
          <SidebarLink icon={Building2} onClick={onWorkspaceSettings}>
            {words.workspaceSettings}
          </SidebarLink>
          <SidebarLink icon={CircleUser} onClick={onAccount}>
            {words.account}
          </SidebarLink>
        </SidebarLinks>
      </SidebarFoot>
    </SidebarFrame>
  );
}

/**
 * The sidebar's frame, in a project and outside one: a name with the mark, which opens and closes
 * it from anywhere with the shortcut too, and below it what the sidebar holds. Closed, only the
 * name stays; narrow, it is a drawer over the page.
 */
export function SidebarFrame({
  label = words.sidebar,
  title,
  open,
  drawer,
  onToggleSidebar,
  children,
}: {
  /** What a screen reader calls the sidebar. */
  label?: string;
  title: string;
  open: boolean;
  drawer: boolean;
  onToggleSidebar: () => void;
  children: ReactNode;
}) {
  const bodyId = `project-sidebar-${useId()}`;
  // The last open or close came from the keyboard, so it happens without moving.
  const [byKey, setByKey] = useState(false);
  // The shortcut opens and closes the sidebar from anywhere on the page.
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
      aria-label={label}
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
          <Mark size={28} />
        </span>
        <span className={styles.project}>{title}</span>
        <Icon aria-hidden="true" />
      </button>
      <div className={styles.room}>
        <div id={bodyId} className={styles.panel} inert={!open}>
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    </aside>
  );
}

/** The sidebar's foot, below what it holds: the links that leave it, smaller and greyer. */
export function SidebarFoot({ children }: { children: ReactNode }) {
  return <div className={styles.utilities}>{children}</div>;
}

/** A few links that go together at the sidebar's foot, named for a screen reader. */
export function SidebarLinks({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <ul className={styles.links} aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * One line saying how the app stands, which opens it. Until there is an app there is no line. Its
 * words change as the app starts, runs or stops, so they are read out as they change.
 */
function AppLine({
  app,
  open,
  onOpen,
}: {
  app: SidebarAppState;
  open: boolean;
  onOpen: () => void;
}) {
  if (app === "not_built") return null;
  return (
    <button
      type="button"
      className={styles.app}
      data-state={app}
      data-current={open ? "" : undefined}
      title={words.openApp}
      onClick={onOpen}
    >
      {/* The library's success tone is the brand's orange, so the app's dot is drawn here, green
          while the app is up. Starting, it turns and its words shimmer as a running step's do. */}
      <span className={styles.dot}>
        {app === "starting" ? (
          <Working />
        ) : (
          <span className={styles.appDot} data-state={app} />
        )}
      </span>
      <span className={styles.name} aria-live="polite">
        {words.appState[app]}
      </span>
      <ArrowUpRight className={styles.go} aria-hidden="true" />
    </button>
  );
}

/** One link at the sidebar's foot; marked while its page is on screen. */
export function SidebarLink({
  icon: Icon,
  current = false,
  onClick,
  children,
}: {
  icon: LucideIcon;
  current?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <SidebarItem
      asChild
      className={styles.link}
      icon={<Icon aria-hidden="true" />}
    >
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={onClick}
      >
        {children}
      </button>
    </SidebarItem>
  );
}

const PLAN = "plan";

const rowKey = (rowId: string) => `row:${rowId}`;

/** A row of the tree, whether or not the fold hides it. */
type TreeRow = {
  key: string;
  /** The row it sits under; null for Plan. */
  parent: string | null;
  /** What a typed letter matches. */
  name: string;
  /** What Enter or Space, or a press, does on it. */
  activate: (() => void) | null;
  /** It has a menu, which Shift+F10 or the context-menu key opens. */
  menu: boolean;
};

/** What every row of the tree takes to hold the tree's one tab stop. */
type TreeItemProps = Required<
  Pick<ComponentProps<"li">, "ref" | "tabIndex" | "onFocus">
>;

/**
 * The plan as a tree with a single tab stop, after the WAI-ARIA tree view pattern: the arrows move
 * between rows and fold Plan, Home and End jump, a letter finds the next row starting with it,
 * Enter or Space folds Plan, opens what a row made or else the row's menu, and Shift+F10 or the
 * context-menu key opens a row's menu. Folding and menus only change the look, so they are held
 * here.
 */
function PlanTree({
  label,
  plan,
  app,
  shown,
  onAskFirst,
  onDecline,
  onOpenStep,
}: {
  label: string;
  plan: readonly SidebarRow[];
  app: SidebarAppState;
  shown: string | null;
  onAskFirst: (stepId: string, askFirst: boolean) => void;
  onDecline: (stepId: string, declined: boolean) => void;
  onOpenStep: (tab: string) => void;
}) {
  // The row whose menu is open.
  const [menu, setMenu] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const folds = plan.length > 0;
  const toggle = () => setFolded(!folded);
  const opener = ({ opens }: SidebarRow) =>
    opens === null ? null : () => onOpenStep(opens);
  const allRows: TreeRow[] = [
    {
      key: PLAN,
      parent: null,
      name: words.plan,
      activate: folds ? toggle : null,
      menu: false,
    },
    ...plan.map((row): TreeRow => {
      const key = rowKey(row.id);
      const menu = row.steps.some(stepHasMenu);
      return {
        key,
        parent: PLAN,
        name: row.name,
        activate: opener(row) ?? (menu ? () => setMenu(key) : null),
        menu,
      };
    }),
  ];
  const rows = folded ? allRows.slice(0, 1) : allRows;
  const items = useRef(new Map<string, HTMLElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // A fold from the keyboard happens at once; one from the pointer slides.
  const [byKey, setByKey] = useState(false);
  // A step folded away hands its place to Plan; Tab enters at the row last focused, else Plan.
  const tabStop =
    focused !== null && rows.some((row) => row.key === focused)
      ? focused
      : PLAN;
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
    const branch = row.parent === null && folds;
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
        if (branch && folded) toggle();
        else if (branch) move(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (branch && !folded) toggle();
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
    onClosed: () => focus(key),
  });
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
        open={folds ? !folded : null}
        busy={
          plan.some((each) => each.state === "needs_you")
            ? "needs_you"
            : plan.some((each) => each.state === "running")
              ? "running"
              : null
        }
        onToggle={toggle}
        {...itemProps(PLAN)}
      >
        <ul role="group" className={styles.rows}>
          {plan.map((row) => (
            <PlanRow
              key={row.id}
              row={row}
              app={row.app ? app : null}
              current={row.opens !== null && row.opens === shown}
              onOpen={opener(row)}
              menu={
                row.steps.some(stepHasMenu) ? (
                  <RowStepsMenu
                    steps={row.steps.filter(stepHasMenu)}
                    menu={menuOf(rowKey(row.id), row.name)}
                    onAskFirst={onAskFirst}
                    onDecline={onDecline}
                  />
                ) : null
              }
              {...itemProps(rowKey(row.id))}
            />
          ))}
        </ul>
      </BranchItem>
    </ul>
  );
}

/**
 * Plan: a row that folds its steps, or, while there are none, says so and does nothing. `open` is
 * null while there is nothing to fold. Folded, it still says what its steps would: it shimmers and
 * turns while one runs, and carries the dot while one waits on the person.
 */
function BranchItem({
  name,
  empty,
  open,
  busy,
  onToggle,
  children,
  ...item
}: {
  name: string;
  empty: string;
  open: boolean | null;
  busy: "running" | "needs_you" | null;
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
        </span>
        <span className={styles.empty} aria-hidden="true">
          {empty}
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
      <span
        className={styles.row}
        data-row="branch"
        data-state={open ? undefined : (busy ?? undefined)}
        onClick={onToggle}
      >
        <span className={styles.name}>{name}</span>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
        {open || busy === null ? null : (
          <span className={styles.dot} data-at="end">
            {busy === "running" ? (
              <Working />
            ) : (
              <span className={styles.waiting} data-state="needs_you" />
            )}
          </span>
        )}
      </span>
      <div className={styles.fold}>
        <div className={styles.folded}>{children}</div>
      </div>
    </li>
  );
}

/**
 * Where a row stands is said by its words: finished ones are quiet, the one being worked on
 * shimmers and turns, and only one that waits on the person or failed carries a dot. It shows what
 * will happen as well as where it stands: a thing that will not be made is struck
 * through, and one whose next step will pause for the person first carries a pause mark, so neither
 * setting hides in its menu. Once the app is built, its row carries the app's own mark and says how
 * it runs.
 */
function PlanRow({
  row,
  app,
  current,
  onOpen,
  menu,
  ...item
}: {
  row: SidebarRow;
  /** How the app stands, on the row that makes it; null on every other. */
  app: SidebarAppState | null;
  /** What it made is on the page. */
  current: boolean;
  /** Opens what it made; null while there is nothing to show. */
  onOpen: (() => void) | null;
  menu: ReactNode;
} & TreeItemProps) {
  const { state } = row;
  const marked = state === "needs_you" || state === "failed";
  const next = row.steps.find(
    (step) => step.state === "to_do" && step.declined !== true,
  );
  const pauses = state === "to_do" && next?.askFirst === true;
  const live = state === "done" && app !== null && app !== "not_built";
  const doing = live ? words.appNow[app] : row.doing;
  const said = [
    row.name,
    state === "declined" ? words.skipped : words.stepState[state],
    ...(doing === null ? [] : [doing]),
    ...(pauses ? [words.pausesFirst] : []),
  ].join(", ");
  return (
    <li
      role="treeitem"
      aria-level={2}
      aria-haspopup={menu === null ? undefined : "menu"}
      aria-label={said}
      aria-current={current ? "page" : undefined}
      className={styles.item}
      title={row.name}
      onClick={
        onOpen === null
          ? undefined
          : (event) => {
              // The row's menu button and the menu it opens are not the row.
              if (
                event.target instanceof Element &&
                event.target.closest("button, [role='menu']") !== null
              )
                return;
              onOpen();
            }
      }
      {...item}
    >
      <span
        className={styles.row}
        data-row="step"
        data-state={state}
        data-opens={onOpen === null ? undefined : ""}
      >
        <span className={styles.text}>
          <span className={styles.name}>{row.name}</span>
          {doing === null ? null : (
            <span className={styles.doing} aria-live="polite">
              {doing}
            </span>
          )}
        </span>
        {live ? (
          <span className={styles.dot}>
            {app === "starting" ? (
              <Working />
            ) : (
              <span className={styles.appDot} data-state={app} />
            )}
          </span>
        ) : state === "running" ? (
          <span className={styles.dot}>
            <Working />
          </span>
        ) : marked ? (
          <span className={styles.dot}>
            <span className={styles.waiting} data-state={state} />
          </span>
        ) : pauses ? (
          <span className={styles.dot} title={words.pausesFirst}>
            <svg
              className={styles.pause}
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path d="M4 2.5v7M8 2.5v7" />
            </svg>
          </span>
        ) : null}
        {menu}
      </span>
    </li>
  );
}

/**
 * Builder is working on it: a faint ring with one arc turning round it, drawn here at the size of
 * a row's dot so it sits in the same column.
 */
function Working() {
  return (
    <svg className={styles.working} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5" data-part="track" />
      <path d="M7 2a5 5 0 0 1 5 5" data-part="arc" />
    </svg>
  );
}

const stepHasMenu = (step: SidebarStep) =>
  step.askFirst !== null || step.declined !== null;

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
      {/* Opened under its button and kept to the sidebar's width, so it never spills onto the page. */}
      <MenuContent
        align="end"
        className={styles.menu}
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

/**
 * A row's menu: the settings of the steps it covers. Each item says what choosing it will do, so
 * the row, not the menu, shows how things stand; where the row covers more than one step with
 * settings, each item names its step.
 */
function RowStepsMenu({
  steps,
  menu,
  onAskFirst,
  onDecline,
}: {
  steps: readonly SidebarStep[];
  menu: RowMenuProps;
  onAskFirst: (stepId: string, askFirst: boolean) => void;
  onDecline: (stepId: string, declined: boolean) => void;
}) {
  const named = steps.length > 1;
  const said = words.stepMenu;
  return (
    <RowMenu {...menu}>
      {steps.flatMap(({ id, name, askFirst, declined }) => [
        askFirst === null || declined === true ? null : (
          <MenuItem
            key={`${id}:ask`}
            onSelect={() => onAskFirst(id, !askFirst)}
          >
            {askFirst
              ? named
                ? said.dontPauseBefore(name)
                : said.dontPause
              : named
                ? said.pauseBefore(name)
                : said.pause}
          </MenuItem>
        ),
        declined === null ? null : (
          <MenuItem
            key={`${id}:skip`}
            onSelect={() => onDecline(id, !declined)}
          >
            {declined
              ? named
                ? said.keepStep(name)
                : said.keep
              : named
                ? said.skipStep(name)
                : said.skip}
          </MenuItem>
        ),
      ])}
    </RowMenu>
  );
}
