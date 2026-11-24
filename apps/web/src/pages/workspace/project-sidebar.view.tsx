/**
 * An open project's sidebar: a card with the project's name and the toggle that opens and closes
 * it, then the project's plan as the coordinator saved it, each step opening what it made once it
 * is made. Closed, the card holds the name and the plan; open, it grows to the window's height
 * around them, with a line saying how the app stands where no step makes it, and at the foot,
 * smaller and greyer, the links that leave it: the project's settings and secrets, the other
 * projects, and the workspace's settings and the person's account. Where the room is narrow it is
 * a drawer over the page. Its frame, foot and links are the workspace sidebar's too, outside a
 * project.
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
  CircleUser,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { SidebarItem } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Mark } from "../../components.jsx";
import { clock, useElapsedMs } from "./elapsed.tsx";
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

/** One step of the plan. A step that makes nothing is listed as much as one that makes something. */
export type SidebarRow = {
  id: string;
  name: string;
  state: SidebarStepState;
  /** It makes the project's app: once built it opens the app and says how it runs. */
  app: boolean;
  /** The tab of what it made, which the row opens; null while there is nothing to show. */
  opens: string | null;
  /** When the step started, so a running one counts up from it; null before it has. */
  startedAt: string | null;
  /** The run's last activity, or why it failed; null while it has said none. */
  summary: string | null;
  /** The steps the row covers; the next one to do says whether Builder pauses before it. */
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
  /**
   * The document opened from what waits in the prompt box, while it still waits: its step says it
   * waits on the person. Null or absent while nothing was opened that way.
   */
  waitsOn?: string | null;
  onToggleSidebar: () => void;
  onOpenApp: () => void;
  /** Opens what a step made, on its tab. */
  onOpenStep: (tab: string) => void;
  /** Absent while the project is still being made, when its settings have nothing to show yet. */
  onProjectSettings?: (() => void) | undefined;
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
  waitsOn = null,
  onToggleSidebar,
  onOpenApp,
  onOpenStep,
  onProjectSettings,
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
      plan={
        <PlanTree
          plan={plan}
          app={app}
          shown={shown}
          waitsOn={waitsOn}
          onOpenStep={onOpenStep}
        />
      }
    >
      {/* The app has its own line only where no step of the plan makes it. */}
      {plan.some((row) => row.app) ? null : (
        <AppLine app={app} open={appOpen} onOpen={onOpenApp} />
      )}
      <SidebarFoot>
        <SidebarLinks label={words.groups.thisProject}>
          <SidebarLink icon={Settings} onClick={onProjectSettings}>
            {words.projectSettings}
          </SidebarLink>
        </SidebarLinks>
        <SidebarLinks label={words.groups.projects}>
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
 * The sidebar's frame, in a project and outside one: a card with the name and the mark, and a
 * toggle that opens and closes it, from anywhere with the shortcut too. Under the name, open or
 * closed and in one place, is the plan; open, the card grows around it with the rest of what the
 * sidebar holds. Narrow, it is a drawer over the page, the plan shown only while open.
 */
export function SidebarFrame({
  label = words.sidebar,
  title,
  open,
  drawer,
  onToggleSidebar,
  plan = null,
  children,
}: {
  /** What a screen reader calls the sidebar. */
  label?: string;
  title: string;
  open: boolean;
  drawer: boolean;
  onToggleSidebar: () => void;
  /** What stays under the name, open or closed, without moving as the card grows. */
  plan?: ReactNode;
  /** What the card holds only while open. */
  children?: ReactNode;
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
  // One root open or closed, so the toggle keeps focus and the plan stays as it is as the sidebar
  // opens and closes.
  return (
    <aside
      className={styles.sidebar}
      data-slot="project-sidebar"
      data-open={open ? "" : undefined}
      data-drawer={drawer ? "" : undefined}
      data-instant={byKey ? "" : undefined}
      aria-label={label}
    >
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.mark}>
            <Mark size={28} />
          </span>
          <span className={styles.project}>{title}</span>
          <button
            type="button"
            className={styles.toggle}
            aria-label={title}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-keyshortcuts={shortcut.key}
            title={`${open ? words.closeSidebar : words.openSidebar} (${shortcut.words})`}
            onClick={() => {
              setByKey(false);
              onToggleSidebar();
            }}
          >
            <Icon aria-hidden="true" />
          </button>
        </div>
        {plan === null ? null : <div className={styles.plan}>{plan}</div>}
        <div id={bodyId} className={styles.body}>
          {children}
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
          while the app is up. Starting, it turns as a running step's does. */}
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
  /** Absent, the link stands disabled. */
  onClick?: (() => void) | undefined;
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
        disabled={onClick === undefined}
        onClick={onClick}
      >
        {children}
      </button>
    </SidebarItem>
  );
}

const rowKey = (rowId: string) => `row:${rowId}`;

/** A row of the tree. */
type TreeRow = {
  key: string;
  /** What a typed letter matches. */
  name: string;
  /** What Enter or Space, or a press, does on it. */
  activate: (() => void) | null;
};

/** What every row of the tree takes to hold the tree's one tab stop. */
type TreeItemProps = Required<
  Pick<ComponentProps<"li">, "ref" | "tabIndex" | "onFocus">
>;

/**
 * The plan's steps, as a tree of one level with a single tab stop, after the WAI-ARIA tree view
 * pattern: the arrows move between rows, Home and End jump, a letter finds the next row starting
 * with it, and Enter or Space opens what a row made.
 */
function PlanTree({
  plan,
  app,
  shown,
  waitsOn,
  onOpenStep,
}: {
  plan: readonly SidebarRow[];
  app: SidebarAppState;
  shown: string | null;
  waitsOn: string | null;
  onOpenStep: (tab: string) => void;
}) {
  const headingId = `plan-${useId()}`;
  const opener = ({ opens }: SidebarRow) =>
    opens === null ? null : () => onOpenStep(opens);
  const rows = plan.map((row): TreeRow => ({
    key: rowKey(row.id),
    name: row.name,
    activate: opener(row),
  }));
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
  // With no plan yet, the place the steps will take says so, rather than standing empty.
  if (plan.length === 0)
    return (
      <section className={styles.steps}>
        <h2 className={styles.planHead}>{words.plan}</h2>
        <p className={styles.planEmpty}>{words.noPlan}</p>
      </section>
    );
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // The row the key was pressed on, which is the tab stop unless focus got there unannounced.
    const on =
      [...items.current].find(([, element]) => element === event.target)?.[0] ??
      tabStop;
    const index = rows.findIndex((row) => row.key === on);
    const row = rows[index];
    if (row === undefined || event.altKey || event.metaKey || event.ctrlKey)
      return;
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
      case "Enter":
      case " ":
        row.activate?.();
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
  const counted = plan.filter((row) => row.state !== "declined");
  const done = counted.filter((row) => row.state === "done").length;
  return (
    <section className={styles.steps}>
      {/* The steps are named as the plan, with how far it has gone beside the name. */}
      <h2 className={styles.planHead}>
        <span id={headingId}>{words.plan}</span>
        <span className={styles.planCount}>
          {words.progress(done, counted.length)}
        </span>
      </h2>
      <ul
        role="tree"
        aria-labelledby={headingId}
        className={styles.tree}
        onKeyDown={onKeyDown}
      >
        {plan.map((row) => (
          <PlanRow
            key={row.id}
            row={row}
            app={row.app ? app : null}
            current={row.opens !== null && row.opens === shown}
            waits={row.opens !== null && row.opens === waitsOn}
            onOpen={opener(row)}
            {...itemProps(rowKey(row.id))}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One step of the plan, as a stop on a timeline: a circle on the line that joins the steps, and the
 * step's name beside it. Only the step at work, one that waits on the person, one that failed and
 * the app's own step have a line under the name: how long it has run, that it waits, that it did
 * not finish, or how the app runs. The one at work turns in its circle. The one whose document is
 * on the page is shaded. What a run last did is often a tool's own words, so it is kept to the
 * row's tooltip. Once a step has made something it opens it.
 */
function PlanRow({
  row,
  app,
  current,
  waits,
  onOpen,
  ...item
}: {
  row: SidebarRow;
  /** How the app stands, on the row that makes it; null on every other. */
  app: SidebarAppState | null;
  /** What it made is on the page. */
  current: boolean;
  /** What waits in the prompt box opened what it made, so it waits on the person too. */
  waits: boolean;
  /** Opens what it made; null while there is nothing to show. */
  onOpen: (() => void) | null;
} & TreeItemProps) {
  const state = waits && row.state !== "failed" ? "needs_you" : row.state;
  const next = row.steps.find(
    (step) => step.state === "to_do" && step.declined !== true,
  );
  const pauses = state === "to_do" && next?.askFirst === true;
  const live = state === "done" && app !== null && app !== "not_built";
  const doing = live ? words.appNow[app] : null;
  const said = [
    row.name,
    state === "declined" ? words.skipped : words.stepState[state],
    ...(doing === null ? [] : [doing]),
    ...(pauses ? [words.pausesFirst] : []),
  ].join(", ");
  const line =
    state === "running" ? (
      <span className={styles.doing}>
        {words.stepNow.working}
        <span aria-hidden="true">·</span>
        <RunningFor since={row.startedAt} />
      </span>
    ) : state === "needs_you" ? (
      <span className={styles.doing} data-tone="you">
        {words.stepNow.needsYou}
      </span>
    ) : state === "failed" ? (
      <span className={styles.doing}>{words.stepNow.failed}</span>
    ) : doing === null ? null : (
      <span className={styles.doing} aria-live="polite">
        {doing}
      </span>
    );
  return (
    <li
      role="treeitem"
      aria-level={1}
      aria-label={said}
      aria-current={current ? "page" : undefined}
      className={styles.step}
      data-state={state}
      data-opens={onOpen === null ? undefined : ""}
      title={row.summary === null ? row.name : `${row.name}: ${row.summary}`}
      onClick={onOpen ?? undefined}
      {...item}
    >
      <span className={styles.circle}>
        {state === "running" ? <Working /> : null}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{row.name}</span>
        {line}
      </span>
    </li>
  );
}

/** How long a step has run, as a clock that counts up each second. */
function RunningFor({ since }: { since: string | null }) {
  const seconds = Math.floor(useElapsedMs(since) / 1000);
  return <span className={styles.clock}>{clock(seconds)}</span>;
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
