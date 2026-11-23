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
import { SidebarItem, StatusDot, type StatusDotTone } from "@corbits/react-ui";
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

/** A part of the plan; its name is a heading only when the plan has more than one. */
export type SidebarPlanGroup = {
  id: string;
  name: string;
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
  plan: readonly SidebarPlanGroup[];
  app: SidebarAppState;
  /** The app is on the page; its line is marked. */
  appOpen: boolean;
  onToggleSidebar: () => void;
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
  app,
  appOpen,
  onToggleSidebar,
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
        onAskFirst={onAskFirst}
        onDecline={onDecline}
      />
      <AppLine app={app} open={appOpen} onOpen={onOpenApp} />
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

const stepKey = (stepId: string) => `step:${stepId}`;

/** A row of the tree, whether or not the fold hides it. */
type TreeRow = {
  key: string;
  /** The row it sits under; null for Plan. */
  parent: string | null;
  /** What a typed letter matches. */
  name: string;
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
 * The plan as a tree with a single tab stop, after the WAI-ARIA tree view pattern: the arrows move
 * between rows and fold Plan, Home and End jump, a letter finds the next row starting with it,
 * Enter or Space folds Plan or opens a step's menu, and Shift+F10 or the context-menu key opens a
 * step's menu. Folding and menus only change the look, so they are held here.
 */
function PlanTree({
  label,
  plan,
  onAskFirst,
  onDecline,
}: {
  label: string;
  plan: readonly SidebarPlanGroup[];
  onAskFirst: (stepId: string, askFirst: boolean) => void;
  onDecline: (stepId: string, declined: boolean) => void;
}) {
  // The row whose menu is open.
  const [menu, setMenu] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const steps = plan.flatMap((group) => group.steps);
  const folds = steps.length > 0;
  const toggle = () => setFolded(!folded);
  const allRows: TreeRow[] = [
    {
      key: PLAN,
      parent: null,
      name: words.plan,
      activate: folds ? toggle : null,
      menu: false,
    },
    ...steps.map((step): TreeRow => {
      const key = stepKey(step.id);
      const menu = stepHasMenu(step);
      return {
        key,
        parent: PLAN,
        name: step.name,
        activate: menu ? () => setMenu(key) : null,
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
        open={folds ? !folded : null}
        busy={
          steps.some((each) => each.state === "needs_you")
            ? "needs_you"
            : steps.some((each) => each.state === "running")
              ? "running"
              : null
        }
        onToggle={toggle}
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
              <StatusDot label="" size="xs" tone="emphasis" />
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

// Where a step stands is said by its words: finished steps are quiet, the one being worked on
// shimmers and turns, and only a step that waits on the person or failed carries a dot.
const stepTone: Partial<Record<SidebarStepState, StatusDotTone>> = {
  needs_you: "emphasis",
  failed: "danger",
};

/**
 * A step's row shows what will happen to it as well as where it stands: a skipped step is struck
 * through, and one that will pause for the person before it starts carries a pause mark, so neither
 * setting hides in its menu.
 */
function StepItem({
  step,
  menu,
  ...item
}: { step: SidebarStep; menu: ReactNode } & TreeItemProps) {
  const { state } = step;
  const tone = stepTone[state];
  const skipped = state === "declined" || step.declined === true;
  const pauses = state === "to_do" && !skipped && step.askFirst === true;
  const said = [
    step.name,
    skipped ? words.skipped : words.stepState[state],
    ...(pauses ? [words.pausesFirst] : []),
  ].join(", ");
  return (
    <li
      role="treeitem"
      aria-level={2}
      aria-haspopup={menu === null ? undefined : "menu"}
      aria-label={said}
      className={styles.item}
      title={step.name}
      {...item}
    >
      <span
        className={styles.row}
        data-row="step"
        data-state={skipped ? "declined" : state}
      >
        <span className={styles.name}>{step.name}</span>
        {state === "running" ? (
          <span className={styles.dot}>
            <Working />
          </span>
        ) : tone !== undefined ? (
          <span className={styles.dot}>
            <StatusDot label="" size="xs" tone={tone} />
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
 * A step's menu, from its button or the keyboard. The button is for the pointer only: the row
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
  // Each item says what choosing it will do, so the row, not the menu, shows how things stand.
  const { askFirst, declined } = step;
  return (
    <RowMenu {...menu}>
      {askFirst === null || declined === true ? null : (
        <MenuItem onSelect={() => onAskFirst(!askFirst)}>
          {askFirst ? words.stepMenu.dontPause : words.stepMenu.pause}
        </MenuItem>
      )}
      {declined === null ? null : (
        <MenuItem onSelect={() => onDecline(!declined)}>
          {declined ? words.stepMenu.keep : words.stepMenu.skip}
        </MenuItem>
      )}
    </RowMenu>
  );
}
