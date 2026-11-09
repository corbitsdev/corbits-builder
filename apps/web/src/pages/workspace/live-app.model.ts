/**
 * The project's app as the hub runs it from the project's current files while the project is
 * open, and what the pane shows of it: the running app, why it is not running, or the Builder's
 * first app taking shape.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InFlightRun, LiveApp } from "@corbits-builder/schemas/artifact";
import { readProjectRunStates } from "../../api/activity.ts";
import {
  downloadApp,
  keepLiveApp,
  readAcceptance,
  readLiveApp,
} from "../../api/artifacts.ts";
import { ApiFailure } from "../../api/types.ts";
import { keys } from "../../queries/keys.ts";
import { wording } from "../../config.ts";
import { activityPhrase } from "./agent-activity.tsx";
import { useProjectActivity } from "./project-activity.ts";
import { useElapsedMs } from "./elapsed.tsx";
import type {
  AppState,
  BuilderSetupViewProps,
  LiveAppViewProps,
} from "./live-app.view.tsx";
import { useFileGroup, ZIP_TYPE } from "./pane-file.tsx";
import { setupProgressLine } from "./setup-progress.ts";

const POLL_MS = 10_000;
const STARTING_POLL_MS = 2_000;
const RUN_STATE_POLL_MS = 5_000;
// Well inside the hub's one-minute grace, so a slow request never lets the app stop.
const PRESENCE_MS = 15_000;
const text = wording.liveApp;

export type LiveAppProps = {
  projectId: string;
  /** The coder building the project's first app, passed only while no app is filed. */
  builder?: InFlightRun | undefined;
};

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

/** The Builder's first app taking shape: what its own tool events say it is doing, while it does. */
export function useBuilderSetup(
  projectId: string,
  builder: InFlightRun,
): BuilderSetupViewProps {
  const agent = useProjectActivity(projectId).data?.agents.find(
    (item) => item.runId === builder.runId,
  );
  // What the build has produced so far, with the time since its last event ticking, so the pane
  // moves every second even while one long step says nothing.
  const quietMs = useElapsedMs(builder.progress?.lastActivityAt);
  return {
    doing: agent === undefined ? undefined : activityPhrase(agent).phrase,
    progress: setupProgressLine(builder.progress, quietMs),
    since: builder.since ?? builder.startedAt,
  };
}

function startingVersion(app: LiveApp): string | undefined {
  if (app.version !== undefined) return text.filedVersion(app.version);
  if (app.commit !== undefined) return text.savedWork(app.commit);
  return undefined;
}

/** How an app that is not running stands, as far as the hub has said. */
function notRunning(
  app: LiveApp | undefined,
  unavailable: boolean,
  refused: string | undefined,
): AppState {
  if (unavailable) return { state: "unavailable" };
  if (refused !== undefined) return { state: "refused", reason: refused };
  if (app === undefined) return { state: "loading" };
  if (app.state === "failed")
    return { state: "failed", error: app.error, log: app.log };
  if (app.state === "not_built" || app.state === "stopped")
    return { state: app.state };
  return {
    state: "starting",
    phase: app.phase ?? "starting",
    version: startingVersion(app),
    fromBuilder: app.source === "builder",
    log: app.log,
  };
}

export function useLiveApp({
  projectId,
  builder,
}: LiveAppProps): Omit<LiveAppViewProps, "builderSetup"> {
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
  const coder = useProjectActivity(projectId).data?.agents.find(
    (agent) => agent.role === "coder",
  );
  const refusal = app.error instanceof ApiFailure ? app.error : undefined;
  const unavailable = refusal?.detail.code === "live_app_unavailable";
  const refused =
    refusal === undefined || unavailable ? undefined : refusal.message;
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
  const filesWritten = builder?.progress?.filesWritten;
  const written = filesWritten !== undefined && filesWritten > 0;
  const starter =
    builder !== undefined &&
    url !== undefined &&
    !written &&
    (builder.progress?.filesWritten === 0 ||
      coderState === "checking" ||
      coderState === "unknown");
  const state = (): AppState => {
    if (url === undefined) {
      const settingUp =
        !unavailable &&
        builder !== undefined &&
        working &&
        data?.state !== "failed";
      return settingUp
        ? { state: "setting_up", url }
        : notRunning(data, unavailable, refused);
    }
    if (unavailable || !starter) return { state: "running", url };
    if (working) return { state: "setting_up", url };
    return {
      state: "held",
      url,
      builder:
        coderState === "checking" || coderState === "unknown"
          ? coderState
          : "idle",
    };
  };
  // The app version downloadApp names, as the zip the hub names after the project. The builder's
  // workspace is filed on download, so its current code downloads mid-build too.
  const files = useFileGroup(
    data?.source === undefined
      ? null
      : {
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
        },
  );
  return {
    app: state(),
    builderStatus: coder === undefined ? null : activityPhrase(coder),
    demoLogin: data?.demoLogin,
    checklist: checklist.data ?? null,
    files,
  };
}
