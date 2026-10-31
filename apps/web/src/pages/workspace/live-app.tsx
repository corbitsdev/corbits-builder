/**
 * The app as the person can use it, run by the hub from the project's current files while the
 * project is open, at an origin of its own. It fills the pane edge to edge, with the pane bar
 * floating over the app and the Builder's acceptance checklist a popover just above the bar.
 * Starting, stopped, failed and not-built states are one centred state each, saying what the hub
 * reports.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ProductApiError } from "@corbits-builder/client";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import { Markdown } from "../../markdown.jsx";
import {
  readProjectActivity,
  readProjectRunStates,
} from "../../api/activity.ts";
import {
  downloadApp,
  keepLiveApp,
  readAcceptance,
  readLiveApp,
} from "../../api/artifacts.ts";
import { keys } from "../../queries/keys.ts";
import { wording } from "../../config.ts";
import { activityPhrase, useProjectActivity } from "./agent-activity.tsx";
import { AppSketch } from "./design-concepts.tsx";
import { clock, useElapsedMs } from "./elapsed.tsx";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import { PaneBar, type PaneBarGroup } from "./pane-bar.tsx";
import { useFileGroup, ZIP_TYPE } from "./pane-file.tsx";

const POLL_MS = 10_000;
const STARTING_POLL_MS = 2_000;
const RUN_STATE_POLL_MS = 5_000;
// Well inside the hub's one-minute grace, so a slow request never lets the app stop.
const PRESENCE_MS = 15_000;
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

type LiveAppState = Awaited<ReturnType<typeof readLiveApp>>;

/** While the project is open the hub keeps its app running; it stops a minute after the page closes. */
export function useLiveAppPresence(projectId: string) {
  const client = useQueryClient();
  useQuery({
    queryKey: keys.liveApp.presence(projectId),
    queryFn: async ({ signal }) => {
      const state = await keepLiveApp(projectId, signal);
      client.setQueryData(keys.liveApp.of(projectId), state);
      return state;
    },
    refetchInterval: PRESENCE_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

function BuilderStatus({ projectId }: { projectId: string }) {
  const activity = useQuery({
    queryKey: keys.projectActivity.of(projectId),
    queryFn: ({ signal }) => readProjectActivity(projectId, signal),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
  });
  const builder = activity.data?.agents.find((agent) => agent.role === "coder");
  if (builder === undefined) return null;
  const { phrase, asking } = activityPhrase(builder);
  return (
    <p className="live-app-status" role="status">
      <StatusDot
        label=""
        live={!asking}
        tone={asking ? "warning" : "emphasis"}
        size="xs"
      />
      {wording.activity.role.coder}: {phrase}
    </p>
  );
}

function SetupClock({ since }: { since: string }) {
  const seconds = Math.floor(useElapsedMs(since) / 1_000);
  return (
    <span className="concept-sketching-clock" role="timer" aria-live="off">
      {text.setup.elapsed(clock(seconds))}
    </span>
  );
}

/** The Builder's first app taking shape: what its own tool events say it is doing, while it does. */
function BuilderSetup({
  projectId,
  builder,
}: {
  projectId: string;
  builder: InFlightRun;
}) {
  const agent = useProjectActivity(projectId).data?.agents.find(
    (item) => item.runId === builder.runId,
  );
  const phrase = agent === undefined ? undefined : activityPhrase(agent).phrase;
  return (
    <div className="concept-sketching" data-state="working" role="status">
      <AppSketch />
      <p className="concept-sketching-lead">{text.setup.working}</p>
      {phrase === undefined ? null : (
        <p className="live-app-setup-activity">
          <ShimmerText key={phrase}>{phrase}</ShimmerText>
        </p>
      )}
      <p className="concept-sketching-note">
        {text.setup.note}{" "}
        <SetupClock since={builder.since ?? builder.startedAt} />
      </p>
    </div>
  );
}

/** The starter's page held back while it is not known to be the person's app. */
function StarterHeld({ coder }: { coder: "checking" | "unknown" | "idle" }) {
  const description = {
    checking: text.setup.checking,
    unknown: text.setup.unknown,
    idle: text.setup.notWritten,
  }[coder];
  return (
    <EmptyState
      className="live-app-state"
      icon={<AppWindow />}
      title={text.notBuiltTitle}
      description={description}
    />
  );
}

function Log({ lines }: { lines: readonly string[] | undefined }) {
  if (!lines?.length) return null;
  return <pre className="live-app-log">{lines.join("\n")}</pre>;
}

function AppState({
  projectId,
  app,
  unavailable,
}: {
  projectId: string;
  app: LiveAppState | undefined;
  unavailable: boolean;
}) {
  if (unavailable)
    return (
      <EmptyState
        className="live-app-state"
        icon={<AppWindow />}
        title={text.unavailableTitle}
        description={text.unavailable}
      />
    );
  if (app === undefined) return null;
  if (app.state === "failed")
    return (
      <div className="live-app-state" role="alert">
        <EmptyState
          icon={<TriangleAlert />}
          title={app.error ?? text.failed}
          description={text.restarts}
        />
        {app.log?.length ? (
          <details className="live-app-output">
            <summary>{text.lastOutput}</summary>
            <Log lines={app.log.slice(-FAILED_LOG_LINES)} />
          </details>
        ) : null}
      </div>
    );
  if (app.state === "not_built")
    return (
      <EmptyState
        className="live-app-state"
        icon={<AppWindow />}
        title={text.notBuiltTitle}
        description={text.notBuilt}
        action={<BuilderStatus projectId={projectId} />}
      />
    );
  if (app.state === "stopped")
    return (
      <EmptyState
        className="live-app-state"
        icon={<AppWindow />}
        title={text.stopped}
        description={text.stoppedNote}
      />
    );
  return (
    <div className="live-app-state" role="status">
      <EmptyState
        icon={<LoaderCircle className="live-app-spinner" />}
        title={text.phase[app.phase ?? "starting"]}
        {...(app.version !== undefined
          ? { description: text.filedVersion(app.version) }
          : app.commit !== undefined
            ? { description: text.savedWork(app.commit) }
            : {})}
        action={
          app.source === "builder" ? (
            <BuilderStatus projectId={projectId} />
          ) : undefined
        }
      />
      <Log lines={app.log} />
    </div>
  );
}

export function LiveApp({
  projectId,
  builder,
  trailing = [],
}: {
  projectId: string;
  /** The coder building the project's first app, passed only while no app is filed. */
  builder?: InFlightRun | undefined;
  /** Pane bar groups after the app's own (tips). */
  trailing?: readonly PaneBarGroup[];
}) {
  const app = useQuery({
    queryKey: keys.liveApp.of(projectId),
    queryFn: ({ signal }) => readLiveApp(projectId, signal),
    refetchInterval: (query) =>
      query.state.data?.state === "running" ? POLL_MS : STARTING_POLL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const data = app.data;
  // The Builder's working copy of the plan's acceptance checklist, read from its workspace: the
  // filed plan is approved by its hash, so the ticks never become a version of it.
  const checklist = useQuery({
    queryKey: keys.acceptance.of(projectId),
    queryFn: ({ signal }) => readAcceptance(projectId, signal),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const markdown = checklist.data ?? null;
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
        event.target.closest(".pane-bar") !== null &&
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
  const unavailable =
    app.error instanceof ProductApiError && app.error.response.status === 503;
  const url = data?.state === "running" ? data.url : undefined;
  // Whether the Builder is mid-turn comes from its committed run events, which survive a hub
  // restart; the hub's count of its writes does not, so an unknown count with an idle Builder
  // shows the app as served.
  const runStates = useQuery({
    queryKey: keys.projectRunStates.of(projectId),
    queryFn: ({ signal }) => readProjectRunStates(projectId, signal),
    enabled: builder !== undefined,
    refetchInterval: RUN_STATE_POLL_MS,
    refetchOnWindowFocus: false,
  });
  const coderState = runStates.isPending
    ? "checking"
    : (runStates.data?.runs.find((run) => run.runId === builder?.runId)
        ?.state ?? "unknown");
  const working = coderState === "working" || coderState === "starting";
  // The first Builder's workspace is the starter until its first write, so until then the app
  // answering is the starter's placeholder page, not the person's app. A known write settles it
  // whatever the run state; a later Builder starts from the filed app, so it is never passed here.
  const written = (builder?.progress?.filesWritten ?? 0) > 0;
  const starter =
    builder !== undefined &&
    url !== undefined &&
    !written &&
    (builder.progress?.filesWritten === 0 ||
      coderState === "checking" ||
      coderState === "unknown");
  const held =
    !unavailable &&
    builder !== undefined &&
    (url === undefined ? working && data?.state !== "failed" : starter);
  // The builder's workspace is filed on download, so its current code downloads mid-build too.
  const downloadable = data?.source !== undefined;
  const login = data?.demoLogin;
  const own: PaneBarGroup = [
    ...(login === undefined
      ? []
      : [
          {
            id: "demo-login",
            label: text.demoLogin(login.email, login.password),
            text: text.demoLogin(login.email, login.password),
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
  // The app version downloadApp names, as the zip the hub names after the project.
  const files = useFileGroup(
    downloadable
      ? {
          type: ZIP_TYPE,
          download: text.download,
          share: text.share,
          key: projectId,
          prepare: "intent",
          build: async () => {
            const { filename, archive, note, current } =
              await downloadApp(projectId);
            return {
              file: new File([archive], filename, { type: ZIP_TYPE }),
              note,
              stale: !current,
            };
          },
        }
      : null,
  );
  const checklistGroup: PaneBarGroup =
    markdown === null
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
    popover.open && markdown !== null ? (
      <Checklist markdown={markdown} onClose={popover.close} />
    ) : null;
  return (
    <div className="live-app">
      {url !== undefined && !held ? (
        <DevicePreview
          src={{ url, title: text.frameTitle }}
          device={device}
          onDevice={setDevice}
          trailing={[own, checklistGroup, files, ...trailing]}
          popover={checklistPopover}
          popoverRef={popover.rootRef}
        />
      ) : (
        <>
          {!held ? (
            <AppState
              projectId={projectId}
              app={data}
              unavailable={unavailable}
            />
          ) : working ? (
            <BuilderSetup projectId={projectId} builder={builder} />
          ) : (
            <StarterHeld
              coder={
                coderState === "checking" || coderState === "unknown"
                  ? coderState
                  : "idle"
              }
            />
          )}
          {markdown === null && !downloadable ? null : (
            <PaneBar
              label={text.controls}
              groups={[own, checklistGroup, files, ...trailing]}
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
        <div className="live-app-checklist-row">
          {mark}
          <span>{item.title}</span>
        </div>
      ) : (
        <details>
          <summary className="live-app-checklist-row">
            {mark}
            <span>{item.title}</span>
          </summary>
          <div className="live-app-checklist-evidence">
            <Markdown source={evidence} />
          </div>
        </details>
      )}
      {item.children.length === 0 ? null : (
        <ul className="live-app-checklist-children">
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
      className="live-app-checklist"
      aria-label={text.checklistTitle}
      role="dialog"
      tabIndex={-1}
    >
      <header className="live-app-checklist-header">
        <h3>{text.checklistTitle}</h3>
        <span className="live-app-checklist-progress" role="status">
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
        <Markdown source={markdown} />
      ) : (
        <ul className="live-app-checklist-items">
          {entries.map((entry, index) =>
            "note" in entry ? (
              <li key={index} className="live-app-checklist-note">
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
