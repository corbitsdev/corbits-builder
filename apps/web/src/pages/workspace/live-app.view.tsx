/**
 * The app as the person can use it, at an origin of its own. It fills the pane edge to edge, with
 * the pane bar floating over the app and the Builder's acceptance checklist a popover just above
 * the bar. Starting, stopped, failed and not-built states are one centred state each, saying what
 * the hub reports.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  EmptyState,
  ShimmerText,
  StatusDot,
  useDismissablePopover,
} from "@corbits/react-ui";
import {
  AppWindow,
  ExternalLink,
  ListChecks,
  LoaderCircle,
  Square,
  SquareCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { DocumentView, Markdown } from "@corbits-builder/plugin-ui/markdown";
import { wording } from "../../config.ts";
import {
  Sketching,
  SketchingClock,
  SketchingLead,
  SketchingNote,
} from "./sketching.tsx";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import { PaneBar, type PaneBarGroup } from "./pane-bar.tsx";
import styles from "./live-app.module.css";

const FAILED_LOG_LINES = 12;
const CHECKLIST_ITEM = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const CODE_FENCE = /^\s*(`{3,}|~{3,})/;
// Only a bare run of the opening fence's character, at least as long, closes it.
const closesFence = (line: string, fence: string) => {
  const bare = line.trim();
  return (
    bare.length >= fence.length && [...bare].every((char) => char === fence[0])
  );
};
const text = wording.liveApp;

/** How the project's app stands, which decides what the pane draws. */
export type AppState =
  /** The hub has not yet said how the app stands, so nothing is drawn. */
  | { state: "loading" }
  /** The app answers at `url` and is framed there. */
  | { state: "running"; url: string }
  /** This Builder cannot run apps. */
  | { state: "unavailable" }
  /** The hub refused to read the app; `reason` says why, in words a person reads. */
  | { state: "refused"; reason: string }
  | {
      state: "failed";
      /** Why the app could not start, in the hub's words. */
      error: string | undefined;
      /** The app's output; its last lines are offered under the state. */
      log: readonly string[] | undefined;
    }
  | { state: "not_built" }
  | { state: "stopped" }
  | {
      state: "starting";
      phase: "installing" | "starting";
      /** Which of the app's files are starting: "App v3", or its latest saved work. */
      version: string | undefined;
      /** The app builder's own files are starting, so what it is doing shows under the state. */
      fromBuilder: boolean;
      log: readonly string[] | undefined;
    }
  /** The app builder is writing the project's first app; the starter may already answer at `url`. */
  | { state: "setting_up"; url: string | undefined }
  /** The starter's page answers at `url` but is held back while it is not known to be the person's app. */
  | { state: "held"; url: string; builder: "checking" | "unknown" | "idle" };

export type LiveAppViewProps = {
  app: AppState;
  /** What the app builder is doing, under a state that waits on it; null while none is at work. */
  builderStatus: BuilderStatusViewProps | null;
  /** The demo account the app seeds, noted in the bar. */
  demoLogin: { email: string; password: string } | undefined;
  /** The Builder's acceptance checklist as it keeps it, in Markdown; null while it has none. */
  checklist: string | null;
  /** The bar's Download and Share for the app's code; empty while there is none to give away. */
  files: PaneBarGroup;
  /** The app builder's first app taking shape. */
  builderSetup: ReactNode;
};

export type BuilderStatusViewProps = {
  /** What the app builder is doing, in the activity strip's words. */
  phrase: string;
};

export function BuilderStatusView({ phrase }: BuilderStatusViewProps) {
  return (
    <p className={styles.status} role="status">
      <StatusDot label="" live tone="emphasis" size="xs" />
      {wording.activity.role.coder}: {phrase}
    </p>
  );
}

const STATE = styles.state;

export type BuilderSetupViewProps = {
  /** What the app builder is doing right now, once its own events say. */
  doing: string | undefined;
  /** What the build has produced so far, with the time since its last event. */
  progress: string | undefined;
  /** When the build began; the clock counts from it. */
  since: string;
};

/** The Builder's first app taking shape: what its own tool events say it is doing, while it does. */
export function BuilderSetupView({
  doing,
  progress,
  since,
}: BuilderSetupViewProps) {
  return (
    <Sketching working>
      <SketchingLead>{text.setup.working}</SketchingLead>
      {doing === undefined ? null : (
        <p className={styles.setupActivity}>
          <ShimmerText key={doing}>{doing}</ShimmerText>
        </p>
      )}
      {progress === undefined ? null : (
        <p className={styles.setupActivity}>{progress}</p>
      )}
      <SketchingNote>
        {text.setup.note}{" "}
        <SketchingClock since={since} label={text.setup.elapsed} />
      </SketchingNote>
    </Sketching>
  );
}

/** The starter's page held back while it is not known to be the person's app. */
function StarterHeld({
  builder,
}: {
  builder: "checking" | "unknown" | "idle";
}) {
  const description = {
    checking: text.setup.checking,
    unknown: text.setup.unknown,
    idle: text.setup.notWritten,
  }[builder];
  return (
    <EmptyState
      className={STATE}
      icon={<AppWindow />}
      title={text.notBuiltTitle}
      description={description}
    />
  );
}

function Log({ lines }: { lines: readonly string[] | undefined }) {
  if (!lines?.length) return null;
  return <pre className={styles.log}>{lines.join("\n")}</pre>;
}

/** The one centred state the pane draws while the app is not framed. */
function StandIn({
  app,
  builderStatus,
  builderSetup,
}: {
  app: Exclude<AppState, { state: "loading" | "running" }>;
  builderStatus: ReactNode;
  builderSetup: ReactNode;
}) {
  if (app.state === "setting_up") return builderSetup;
  if (app.state === "held") return <StarterHeld builder={app.builder} />;
  if (app.state === "unavailable")
    return (
      <EmptyState
        className={STATE}
        icon={<AppWindow />}
        title={text.unavailableTitle}
        description={text.unavailable}
      />
    );
  if (app.state === "refused")
    return (
      <EmptyState
        className={STATE}
        icon={<TriangleAlert />}
        title={app.reason}
      />
    );
  if (app.state === "failed")
    return (
      <div className={styles.state} role="alert">
        <EmptyState
          icon={<TriangleAlert />}
          title={app.error ?? text.failed}
          description={text.restarts}
        />
        {app.log?.length ? (
          <details className={styles.output}>
            <summary>{text.lastOutput}</summary>
            <Log lines={app.log.slice(-FAILED_LOG_LINES)} />
          </details>
        ) : null}
      </div>
    );
  if (app.state === "not_built")
    return (
      <EmptyState
        className={STATE}
        icon={<AppWindow />}
        title={text.notBuiltTitle}
        description={text.notBuilt}
        action={builderStatus}
      />
    );
  if (app.state === "stopped")
    return (
      <EmptyState
        className={STATE}
        icon={<AppWindow />}
        title={text.stopped}
        description={text.stoppedNote}
      />
    );
  return (
    <div className={styles.state} role="status">
      <EmptyState
        icon={<LoaderCircle className={styles.spinner} />}
        title={text.phase[app.phase]}
        {...(app.version === undefined ? {} : { description: app.version })}
        action={app.fromBuilder ? builderStatus : undefined}
      />
      <Log lines={app.log} />
    </div>
  );
}

export function LiveAppView({
  app,
  builderStatus,
  demoLogin,
  checklist,
  files,
  builderSetup,
}: LiveAppViewProps) {
  const url = "url" in app ? app.url : undefined;
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const popover = useDismissablePopover<HTMLDivElement, HTMLButtonElement>();
  const {
    open: checklistOpen,
    setOpen: setChecklistOpen,
    triggerRef,
  } = popover;
  // The popover's anchor holds the bar, so the hook counts its other buttons as inside; and a press
  // in the app's frame never reaches this page, which sees only its window lose focus to the frame.
  useEffect(() => {
    if (!checklistOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-slot="pane-bar"]') !== null &&
        triggerRef.current?.contains(event.target) !== true
      )
        setChecklistOpen(false);
    };
    const onBlur = () =>
      setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement)
          setChecklistOpen(false);
      });
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [checklistOpen, setChecklistOpen, triggerRef]);
  const own: PaneBarGroup = [
    ...(demoLogin === undefined
      ? []
      : [
          {
            id: "demo-login",
            label: text.demoLogin(demoLogin.email, demoLogin.password),
            text: text.demoLogin(demoLogin.email, demoLogin.password),
            note: true,
          },
        ]),
    ...(url === undefined
      ? []
      : [
          {
            id: "open",
            label: text.openInNewTab,
            icon: <ExternalLink size={16} aria-hidden="true" />,
            onSelect: () => window.open(url, "_blank", "noopener"),
          },
        ]),
  ];
  const checklistGroup: PaneBarGroup =
    checklist === null
      ? []
      : [
          {
            id: "checklist",
            label: popover.open ? text.checklistHide : text.checklistShow,
            icon: <ListChecks size={16} aria-hidden="true" />,
            active: popover.open,
            ref: popover.triggerRef,
            onSelect: () => popover.setOpen((open) => !open),
          },
        ];
  const checklistPopover =
    popover.open && checklist !== null ? (
      <Checklist markdown={checklist} onClose={popover.close} />
    ) : null;
  return (
    <div className={styles.app} data-slot="live-app">
      {app.state === "running" ? (
        <DevicePreview
          src={{ url: app.url, title: text.frameTitle }}
          device={device}
          onDevice={setDevice}
          trailing={[own, checklistGroup, files]}
          popover={checklistPopover}
          popoverRef={popover.rootRef}
          fill
        />
      ) : (
        <>
          {app.state === "loading" ? null : (
            <StandIn
              app={app}
              builderStatus={
                builderStatus === null ? null : (
                  <BuilderStatusView {...builderStatus} />
                )
              }
              builderSetup={builderSetup}
            />
          )}
          {checklist === null && files.length === 0 ? null : (
            <PaneBar
              label={text.controls}
              groups={[own, checklistGroup, files]}
              floating
              popover={checklistPopover}
              popoverRef={popover.rootRef}
            />
          )}
        </>
      )}
    </div>
  );
}

type ChecklistItem = {
  done: boolean;
  title: string;
  evidence: string[];
  children: ChecklistItem[];
};
type ChecklistNote = { note: string };
type ChecklistEntry = ChecklistItem | ChecklistNote;

const append = (target: ChecklistItem | ChecklistNote, line: string) => {
  if ("note" in target)
    target.note = target.note === "" ? line : `${target.note}\n${line}`;
  else target.evidence.push(line);
};

// Each "- [x] AC-n: title" line opens an item, a child of the item it is indented under, and the
// lines indented under an item are its evidence; any other lines (headings, notes) are kept in
// place as written. A fenced block stays whole with whichever its opening line belongs to, never as items.
function checklistEntries(markdown: string): ChecklistEntry[] {
  const entries: ChecklistEntry[] = [];
  const open: { indent: number; item: ChecklistItem }[] = [];
  let note: ChecklistNote | undefined;
  let fenced:
    | { target: ChecklistItem | ChecklistNote; fence: string }
    | undefined;
  for (const line of markdown.split("\n")) {
    if (fenced !== undefined) {
      append(fenced.target, line);
      if (closesFence(line, fenced.fence)) fenced = undefined;
      continue;
    }
    const match = CHECKLIST_ITEM.exec(line);
    if (match !== null) {
      const indent = match[1]!.length;
      const item = {
        done: match[2] !== " ",
        title: match[3]!.trim(),
        evidence: [],
        children: [],
      };
      while (open.length > 0 && open.at(-1)!.indent >= indent) open.pop();
      (open.at(-1)?.item.children ?? entries).push(item);
      open.push({ indent, item });
      note = undefined;
      continue;
    }
    if (line.trim() !== "") {
      const indent = /^\s*/.exec(line)![0].length;
      while (open.length > 0 && open.at(-1)!.indent >= indent) open.pop();
    }
    const item = open.at(-1)?.item;
    let target: ChecklistItem | ChecklistNote;
    if (item !== undefined) target = item;
    else if (line.trim() === "") {
      if (note !== undefined) note.note += "\n";
      continue;
    } else {
      if (note === undefined) {
        note = { note: "" };
        entries.push(note);
      }
      target = note;
    }
    append(target, line);
    const fence = CODE_FENCE.exec(line)?.[1];
    if (fence !== undefined) fenced = { target, fence };
  }
  return entries;
}

// Evidence lines without the indent they share under their item, so Markdown reads them as written.
function evidenceText(lines: readonly string[]): string {
  const written = lines.filter((line) => line.trim() !== "");
  const indent = Math.min(
    ...written.map((line) => /^\s*/.exec(line)![0].length),
  );
  return lines
    .map((line) => line.slice(indent))
    .join("\n")
    .trim();
}

const countItems = (
  items: readonly ChecklistItem[],
): { done: number; total: number } =>
  items.reduce(
    (count, item) => {
      const children = countItems(item.children);
      return {
        done: count.done + (item.done ? 1 : 0) + children.done,
        total: count.total + 1 + children.total,
      };
    },
    { done: 0, total: 0 },
  );

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const mark = item.done ? (
    <SquareCheck size={16} aria-label={text.checklistDone} />
  ) : (
    <Square size={16} aria-label={text.checklistOpen} />
  );
  const evidence = evidenceText(item.evidence);
  return (
    <li data-done={item.done ? "" : undefined}>
      {evidence === "" ? (
        <div className={styles.checklistRow}>
          {mark}
          <span>{item.title}</span>
        </div>
      ) : (
        <details>
          <summary className={styles.checklistRow}>
            {mark}
            <span>{item.title}</span>
          </summary>
          <div className={styles.checklistEvidence}>
            <DocumentView source={evidence} />
          </div>
        </details>
      )}
      {item.children.length === 0 ? null : (
        <ul className={styles.checklistChildren}>
          {item.children.map((child, index) => (
            <ChecklistRow key={index} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The checklist as a popover over the floating bar: one compact row per item, evidence on demand. */
function Checklist({
  markdown,
  onClose,
}: {
  markdown: string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => panel.current?.focus(), []);
  const entries = checklistEntries(markdown);
  const { done, total } = countItems(
    entries.filter((entry): entry is ChecklistItem => !("note" in entry)),
  );
  return (
    <aside
      ref={panel}
      className={styles.checklist}
      aria-label={text.checklistTitle}
      role="dialog"
      tabIndex={-1}
    >
      <header className={styles.checklistHeader}>
        <h3>{text.checklistTitle}</h3>
        <span className={styles.checklistProgress} role="status">
          {text.checklistProgress(done, total)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={text.checklistHide}
          title={text.checklistHide}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      {total === 0 ? (
        <DocumentView source={markdown} />
      ) : (
        <ul className={styles.checklistItems}>
          {entries.map((entry, index) =>
            "note" in entry ? (
              <li key={index} className={styles.checklistNote}>
                <Markdown source={entry.note} />
              </li>
            ) : (
              <ChecklistRow key={index} item={entry} />
            ),
          )}
        </ul>
      )}
    </aside>
  );
}
