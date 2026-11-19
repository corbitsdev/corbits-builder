/**
 * An open project's sidebar: the project's name, which opens and closes it, then the project's steps
 * (Plan, Design, Build) as a tree, each listing the documents it has made, and the live app once
 * there is one. Settings and the ways out of the project sit small at the bottom, the workspace menu
 * last. Closed, only the project's name stays. Where the room is narrow it is a drawer over the page.
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
  ChevronRight,
  LayoutGrid,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from "lucide-react";
import {
  SidebarItem,
  StatusDot,
  Switch,
  TypingIndicator,
  type StatusDotTone,
} from "@corbits/react-ui";
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

/** Where a document stands, as its row marks it: one mark at most, none when it is ready. */
export type SidebarDocumentState = "ready" | "needs_you" | "writing" | "failed";

export type SidebarDocument = {
  id: string;
  /** The document's name, as its tab names it. */
  name: string;
  state: SidebarDocumentState;
};

/** One step of the project and the documents it has made so far; none while it has not started. */
export type SidebarStep = {
  id: string;
  name: string;
  documents: readonly SidebarDocument[];
  /** Its documents are listed; folded, only the step shows. */
  open: boolean;
};

/** The project's app, once there is one to run. */
export type SidebarLiveApp = {
  running: boolean;
  /** A start or stop is on its way; the switch holds until it lands. */
  changing: boolean;
};

export type ProjectSidebarViewProps = {
  project: string;
  /** Closed, only the project's name shows, to open it again. */
  open: boolean;
  /** The room is narrow, so the open sidebar lies over the page. */
  drawer: boolean;
  steps: readonly SidebarStep[];
  /** The document on the page; its row is marked. */
  selectedDocument: string | null;
  /** Null until the project has an app. */
  liveApp: SidebarLiveApp | null;
  /** The workspace menu, last in the sidebar. */
  workspaceMenu: ReactNode;
  onToggleSidebar: () => void;
  onToggleStep: (stepId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onToggleLiveApp: (running: boolean) => void;
  onProjectSettings: () => void;
  onSecrets: () => void;
  onAllProjects: () => void;
  onNewProject: () => void;
};

export function ProjectSidebarView({
  project,
  open,
  drawer,
  steps,
  selectedDocument,
  liveApp,
  workspaceMenu,
  onToggleSidebar,
  onToggleStep,
  onOpenDocument,
  onToggleLiveApp,
  onProjectSettings,
  onSecrets,
  onAllProjects,
  onNewProject,
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
            <StepTree
              label={project}
              steps={steps}
              selectedDocument={selectedDocument}
              onToggleStep={onToggleStep}
              onOpenDocument={onOpenDocument}
            />
            {liveApp === null ? null : (
              <LiveApp app={liveApp} onToggle={onToggleLiveApp} />
            )}
            <ul className={styles.utilities}>
              <SidebarItem asChild icon={<Settings />}>
                <button type="button" onClick={onProjectSettings}>
                  {words.projectSettings}
                </button>
              </SidebarItem>
              <SidebarItem asChild icon={<Lock />}>
                <button type="button" onClick={onSecrets}>
                  {wording.settings.tab.secrets}
                </button>
              </SidebarItem>
            </ul>
            <ul className={styles.utilities}>
              <SidebarItem asChild icon={<LayoutGrid />}>
                <button type="button" onClick={onAllProjects}>
                  {wording.shell.projects}
                </button>
              </SidebarItem>
              <SidebarItem asChild icon={<Plus />}>
                <button type="button" onClick={onNewProject}>
                  {wording.shell.newProject}
                </button>
              </SidebarItem>
            </ul>
            <div className={styles.workspace}>{workspaceMenu}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** A row of the tree in the order it shows: a step, or a document under an open step. */
type TreeRow =
  | { key: string; kind: "step"; step: SidebarStep }
  | { key: string; kind: "document"; document: SidebarDocument };

/** What every row of the tree takes to hold the tree's one tab stop. */
type TreeItemProps = Required<
  Pick<ComponentProps<"li">, "ref" | "tabIndex" | "onFocus">
>;

const stepKey = (step: SidebarStep) => `step:${step.id}`;
const documentKey = (documentId: string) => `document:${documentId}`;

function visibleRows(steps: readonly SidebarStep[]): TreeRow[] {
  return steps.flatMap((step): TreeRow[] => [
    { key: stepKey(step), kind: "step", step },
    ...(step.open
      ? step.documents.map((document) => ({
          key: documentKey(document.id),
          kind: "document" as const,
          document,
        }))
      : []),
  ]);
}

const rowName = (row: TreeRow) =>
  row.kind === "step" ? row.step.name : row.document.name;

/**
 * The steps and their documents as one tree with a single tab stop, after the WAI-ARIA tree view
 * pattern: the arrows move between and fold rows, Home and End jump, a letter finds the next row
 * starting with it, and Enter or Space opens a document or folds a step.
 */
function StepTree({
  label,
  steps,
  selectedDocument,
  onToggleStep,
  onOpenDocument,
}: {
  label: string;
  steps: readonly SidebarStep[];
  selectedDocument: string | null;
  onToggleStep: (stepId: string) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const rows = visibleRows(steps);
  const items = useRef(new Map<string, HTMLElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // A fold from the keyboard happens at once; one from the pointer slides.
  const [byKey, setByKey] = useState(false);
  // Each document's step, folded or not, so a row folded away can hand its place to its step.
  const parents = new Map(
    steps.flatMap((step) =>
      step.documents.map((document): [string, string] => [
        documentKey(document.id),
        stepKey(step),
      ]),
    ),
  );
  const placeOf = (key: string | null) =>
    key === null
      ? undefined
      : rows.some((row) => row.key === key)
        ? key
        : parents.get(key);
  // Tab enters at the row last focused, else the open document, else the first row.
  const tabStop =
    placeOf(focused) ??
    placeOf(selectedDocument === null ? null : documentKey(selectedDocument)) ??
    rows[0]?.key ??
    null;
  const focus = (key: string) => {
    setFocused(key);
    items.current.get(key)?.focus();
  };
  const activate = (row: TreeRow) => {
    if (row.kind === "document") onOpenDocument(row.document.id);
    else if (row.step.documents.length > 0) onToggleStep(row.step.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = rows.findIndex((row) => row.key === tabStop);
    const row = rows[index];
    if (row === undefined || event.altKey || event.metaKey || event.ctrlKey)
      return;
    const opens = row.kind === "step" && row.step.documents.length > 0;
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
        if (opens && !row.step.open) onToggleStep(row.step.id);
        else if (opens) move(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (row.kind === "document") {
          const parent = parents.get(row.key);
          if (parent !== undefined) focus(parent);
        } else if (opens && row.step.open) onToggleStep(row.step.id);
        break;
      case "Enter":
      case " ":
        activate(row);
        break;
      default: {
        if (event.key.length !== 1 || event.key === " ") return;
        const letter = event.key.toLowerCase();
        const after = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
        const found = after.find((each) =>
          rowName(each).toLowerCase().startsWith(letter),
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
  return (
    <ul
      role="tree"
      aria-label={label}
      className={styles.tree}
      data-keyboard={byKey ? "" : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={() => setByKey(false)}
    >
      {steps.map((step) => {
        if (step.documents.length === 0)
          return (
            <li
              key={step.id}
              role="treeitem"
              aria-level={1}
              aria-disabled="true"
              aria-label={`${step.name}, ${words.notStarted}`}
              className={styles.item}
              {...itemProps(stepKey(step))}
            >
              <span className={styles.row} data-row="step" data-empty="">
                <span className={styles.name}>{step.name}</span>
                <span className={styles.note}>{words.notStarted}</span>
              </span>
            </li>
          );
        return (
          <li
            key={step.id}
            role="treeitem"
            aria-level={1}
            aria-expanded={step.open}
            aria-label={step.name}
            className={styles.item}
            data-open={step.open ? "" : undefined}
            {...itemProps(stepKey(step))}
          >
            <span
              className={styles.row}
              data-row="step"
              onClick={() => onToggleStep(step.id)}
            >
              <ChevronRight className={styles.chevron} aria-hidden="true" />
              <span className={styles.name}>{step.name}</span>
            </span>
            <div className={styles.fold}>
              <ul role="group" className={styles.documents}>
                {step.documents.map((document) => (
                  <DocumentItem
                    key={document.id}
                    document={document}
                    selected={document.id === selectedDocument}
                    onOpen={() => onOpenDocument(document.id)}
                    {...itemProps(documentKey(document.id))}
                  />
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// The row's name already says the state, so its mark carries no words of its own.
const documentTone: Record<
  Exclude<SidebarDocumentState, "ready" | "writing">,
  StatusDotTone
> = { needs_you: "emphasis", failed: "danger" };

function DocumentItem({
  document,
  selected,
  onOpen,
  ...item
}: {
  document: SidebarDocument;
  selected: boolean;
  onOpen: () => void;
} & TreeItemProps) {
  const { state } = document;
  return (
    <li
      role="treeitem"
      aria-level={2}
      aria-current={selected ? "page" : undefined}
      aria-label={
        state === "ready"
          ? document.name
          : `${document.name}, ${words.documentState[state]}`
      }
      className={styles.item}
      title={document.name}
      {...item}
    >
      <span
        className={styles.row}
        data-row="document"
        data-state={state}
        onClick={onOpen}
      >
        <span className={styles.name}>{document.name}</span>
        {state === "ready" ? null : state === "writing" ? (
          <span className={styles.writing} aria-hidden="true">
            <TypingIndicator label={words.documentState.writing} />
          </span>
        ) : (
          <StatusDot label="" size="xs" tone={documentTone[state]} />
        )}
      </span>
    </li>
  );
}

/**
 * The live app's switch keeps one name and is described by how the app stands. While a start or
 * stop is on its way the switch stays in reach but holds.
 */
function LiveApp({
  app,
  onToggle,
}: {
  app: SidebarLiveApp;
  onToggle: (running: boolean) => void;
}) {
  const stateId = `live-state-${useId()}`;
  const state = app.changing
    ? app.running
      ? words.stopping
      : words.starting
    : app.running
      ? words.running
      : words.stopped;
  return (
    <div className={styles.live} data-changing={app.changing ? "" : undefined}>
      <span className={styles.liveName}>{wording.liveApp.tab}</span>
      {/* The switch already shows on, off and holding; there is no room for the words beside it. */}
      <span id={stateId} className="sr-only" aria-live="polite">
        {state}
      </span>
      <Switch
        className={styles.switch}
        checked={app.running}
        label={wording.liveApp.tab}
        describedBy={stateId}
        onCheckedChange={(running) => {
          if (!app.changing) onToggle(running);
        }}
      />
    </div>
  );
}
