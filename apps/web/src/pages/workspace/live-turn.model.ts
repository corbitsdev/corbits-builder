/**
 * The coordinator's turn as the room shows it. The durable mirror is the committed transcript; the
 * run's stream fills the gap while a message run is producing it, and each committed reply keeps
 * the thinking and tool work this session watched, or else its saved calls. A run that died before
 * replying is said once.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ConversationPart } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { subscribeWorkflowRun } from "../../api/run-stream.ts";
import type {
  ConversationEvent,
  ConversationTurn,
} from "../../api/conversation.ts";
import { humanFault } from "../../human-fault.ts";
import {
  awaitingCommit,
  committedSteps,
  emptyLiveRun,
  foldLiveRun,
  latestAssistantAt,
  pendingLiveTurn,
  sameParts,
  type LiveRun,
} from "./live-run.ts";
import { withPendingSends, type SentMessage } from "./pending-sends.ts";
import {
  savedResults,
  savedTurnSteps,
  useSavedRunSteps,
} from "./run-preview.ts";
import { useSessionMemory, withEntries } from "./session-memory.ts";
import { visibleChatText, withSteps } from "./visible-chat.ts";

const NO_STEPS: ReadonlyMap<number, readonly ConversationPart[]> = new Map();

export function useLiveTurn({
  projectId,
  runId,
  runTenantId,
  events,
  mirror,
  reload,
  composer,
}: {
  projectId: string;
  /** The coordinator run to stream; null while none is bound or the project is archived. */
  runId: string | null;
  runTenantId: string | undefined;
  /** The room's conversation events; null until a coordinator is bound. */
  events: readonly ConversationEvent[] | null;
  mirror: readonly ConversationTurn[];
  reload: () => void;
  composer: {
    /** The person's messages sent from here that the mirror may not have yet. */
    sent: readonly SentMessage[];
    /** Says the coordinator stopped, in place of the reply the person waits on. */
    fail: (message: string) => void;
  };
}) {
  const [liveRun, setLiveRun] = useState<LiveRun>(emptyLiveRun);
  const liveRunRef = useRef<LiveRun>(emptyLiveRun);
  // The stream folds each event against the latest committed reply, read once the render commits.
  const committedAt = latestAssistantAt(mirror);
  const committedAtRef = useRef(committedAt);
  useEffect(() => {
    committedAtRef.current = committedAt;
  }, [committedAt]);
  const reportedFailure = useRef<number | null>(null);

  // The durable mirror is the committed transcript. The stream fills the gap
  // while a message run is producing it, and says when to read the room
  // again. A dropped stream reads the room too: the coordinator run it named
  // may have been replaced, and a new run id resubscribes here.
  useEffect(() => {
    liveRunRef.current = emptyLiveRun;
    setLiveRun(emptyLiveRun);
    if (runId === null || runTenantId === undefined) return;
    return subscribeWorkflowRun(runTenantId, runId, {
      onEvent: (event) => {
        const next = foldLiveRun(
          liveRunRef.current,
          event,
          committedAtRef.current,
        );
        liveRunRef.current = next.run;
        setLiveRun(next.run);
        if (next.reload) reload();
      },
      onChange: reload,
      onReconnect: reload,
      onError: reload,
    }).unsubscribe;
  }, [projectId, runId, runTenantId, reload]);

  const settling = awaitingCommit(liveRun, mirror);

  // A dead run is not a quiet colleague. Say so once, and stop the thinking
  // mark, when the person is still waiting on a reply that will not come.
  useEffect(() => {
    if (!events || mirror.some((turn) => turn.role === "assistant")) return;
    const failure = [...events]
      .reverse()
      .find(
        (event) => event.type === "StepFailed" || event.type === "RunFailed",
      );
    if (!failure || reportedFailure.current !== null) return;
    reportedFailure.current = failure.seq;
    const detail = failure.body["message"];
    const visible = typeof detail === "string" ? visibleChatText(detail) : "";
    const message =
      visible.length > 0
        ? humanFault(new Error(visible), wording.message.coordinatorStopped)
        : wording.message.coordinatorStopped;
    composer.fail(message);
    toast.error(message);
  }, [events, mirror]);

  // Each committed reply's thinking and tool work, as this session watched it.
  const stepsByAt = useSessionMemory(NO_STEPS, (known) =>
    withEntries(known, committedSteps(liveRun, mirror), sameParts),
  );
  // What this session watched the coordinator do wins; a reply from before it has its saved calls.
  const coordinatorSteps = useSavedRunSteps(runTenantId, runId);
  const turns = useMemo(
    () =>
      withSteps(
        withPendingSends(mirror, composer.sent),
        stepsByAt,
        savedTurnSteps(
          coordinatorSteps.steps,
          mirror.flatMap((turn) =>
            turn.role === "assistant" ? [turn.at] : [],
          ),
        ),
      ),
    [mirror, composer.sent, coordinatorSteps.steps, stepsByAt],
  );
  // What each of the coordinator's calls returned, saved or as this session watched it.
  const coordinatorResults = new Map([
    ...savedResults(coordinatorSteps.steps),
    ...liveRun.results,
  ]);

  return {
    liveRun,
    /** A run closed and the mirror has not committed its reply yet. */
    settling,
    /** The committed transcript with the person's pending sends and each reply's steps. */
    turns,
    coordinatorResults,
    /** The reply the stream is producing that the mirror has not committed. */
    liveTurn: pendingLiveTurn(liveRun, mirror),
  };
}
