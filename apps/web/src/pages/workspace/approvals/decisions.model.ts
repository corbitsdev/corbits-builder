/**
 * What waits on the person's decision, and who is at work. The open decisions and the activity are
 * read again together whenever the room moves, a decision is made here, or a run parks on an
 * approval. A decision made here shows at once; a decline can carry the person's words as its
 * reason.
 */
import { useEffect, useState } from "react";
import {
  queryOptions,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ProductApiError } from "@corbits-builder/client";
import { deliveredText } from "@corbits-builder/schemas/conversation";
import { wording } from "../../../config.ts";
import { decideApproval, openDecisions } from "../../../api/decisions.ts";
import type { ChatMessage, Wait } from "../../../api/types.ts";
import { humanFault, humanFaultWithCode } from "../../../human-fault.ts";
import { keys } from "../../../queries/keys.ts";
import {
  documentApprovalsFrom,
  openApprovalOf,
  pendingApprovalsFrom,
  type OpenApproval,
} from "../collaboration.ts";
import {
  heldOnApproval,
  useProjectActivity,
  useProjectRunStates,
} from "../project-activity.ts";
import type { RoomSnapshot } from "../pane/load-room.ts";
import { useSettledApprovals } from "./settled-approvals.ts";

// Only an active project has a coordinator whose decisions can be open. The one room read never
// shown from an earlier visit, saved or in memory: a card answered since would be offered again,
// and the person could act on it.
export function openDecisionsQuery(projectId: string, active: boolean) {
  return queryOptions({
    queryKey: keys.openDecisions.of(projectId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    meta: { persist: false },
    refetchOnWindowFocus: false,
    queryFn: active ? () => openDecisions(projectId) : skipToken,
  });
}

export type RoomDecisions = ReturnType<typeof useDecisions>;

export function useDecisions({
  projectId,
  status,
  snapshot,
  onChanged,
  composer,
}: {
  projectId: string;
  status: string;
  /** Each new read of the room reads the decisions and the activity again. */
  snapshot: RoomSnapshot;
  onChanged: () => void;
  composer: {
    /** Mails the words as an ordinary message, for a decline the ask could no longer take. */
    post: (words: string) => Promise<ChatMessage>;
  };
}) {
  const queryClient = useQueryClient();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [gateDone, setGateDone] = useState(0);
  // The waits that belong to this project, from the open decisions.
  const decisions = useQuery(
    openDecisionsQuery(projectId, status === "active"),
  );
  // Once per outage: each failed poll is a new error, and a dismissed toast stays dismissed.
  useEffect(() => {
    if (!decisions.isError) return;
    toast.error(humanFault(decisions.error, wording.approval.notRead), {
      id: "waits-read",
    });
  }, [decisions.isError]);
  // Undefined until read: an unread list is not one with nothing open.
  const waits = decisions.data;
  const activity = useProjectActivity(projectId);
  useEffect(() => {
    if (!activity.isError) return;
    toast.error(humanFault(activity.error, wording.activity.notRead), {
      id: "activity-read",
    });
  }, [activity.isError]);
  // The runs held on an approval, from the polled run states: a coder's package request raises no
  // room event, so the room alone would not say the person's turn came until something else moved.
  const awaitingApproval = heldOnApproval(useProjectRunStates(projectId).data);
  // A room that moved may mean a message reached the coordinator from elsewhere, or a coordinator
  // or coder decision opened; read who is at work and the open decisions. A run parking on an
  // approval moves no room, so the open decisions are read again then too.
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: keys.projectActivity.of(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: keys.openDecisions.of(projectId),
    });
  }, [projectId, queryClient, snapshot, gateDone, awaitingApproval]);
  const documentApprovals =
    waits === undefined ? undefined : documentApprovalsFrom(waits);
  const { settled: settledApprovals, settle } = useSettledApprovals(
    projectId,
    documentApprovals,
  );
  const pendingFrom = (list: readonly Wait[]): OpenApproval[] =>
    pendingApprovalsFrom(list, settledApprovals);
  const pendingApprovals = waits === undefined ? undefined : pendingFrom(waits);
  const openApprovalIds = new Set(
    pendingApprovals?.map((approval) => approval.approvalId),
  );
  // A park created moments after `inference.done` can already stand on the hub before the next
  // room reload lands; read once on demand when the cached list shows no open ask.
  const readPendingApprovals = async (): Promise<
    readonly OpenApproval[] | undefined
  > => {
    if (pendingApprovals !== undefined && pendingApprovals.length > 0)
      return pendingApprovals;
    try {
      const fresh = await queryClient.fetchQuery(
        openDecisionsQuery(projectId, true),
      );
      return pendingFrom(fresh);
    } catch (cause) {
      // The cached list is still the best answer; the send that follows reports a hub that is down.
      console.warn("Open decisions could not be re-read.", cause);
      return pendingApprovals;
    }
  };
  // "settled" is a 409: someone already decided the ask, or its run moved on; the page reads
  // where it stands.
  const saveDecision = async (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
    message?: string;
  }): Promise<"saved" | "settled" | { fault: string }> => {
    const notSaved = { fault: wording.approval.notSaved };
    const cachedWaits = queryClient.getQueryData<readonly Wait[]>(
      keys.openDecisions.of(projectId),
    );
    const wait =
      waits?.find((item) => item.approvalId === decision.approvalId) ??
      cachedWaits?.find((item) => item.approvalId === decision.approvalId);
    const approvalId = wait?.approvalId;
    const tenantId = wait?.tenantId;
    if (
      wait === undefined ||
      approvalId === undefined ||
      tenantId === undefined ||
      approvalBusy
    )
      return notSaved;
    setApprovalBusy(true);
    setApprovalError(null);
    const decided =
      documentApprovals?.find((item) => item.approvalId === approvalId) ??
      (cachedWaits === undefined
        ? undefined
        : documentApprovalsFrom(cachedWaits).find(
            (item) => item.approvalId === approvalId,
          ));
    try {
      await decideApproval({
        tenantId,
        approvalId,
        decision:
          decision.choice === "yes" || decision.choice === "always"
            ? "approve"
            : "reject",
        ...(decision.choice === "always" ? { scope: "always" as const } : {}),
        ...(decision.message === undefined
          ? {}
          : { message: decision.message }),
      });
      if (decided !== undefined)
        settle(decided, {
          status:
            decision.choice === "yes" || decision.choice === "always"
              ? "approved"
              : "rejected",
          ...(decision.choice === "always" ? { scope: "always" } : {}),
        });
      setGateDone((value) => value + 1);
      onChanged();
      return "saved";
    } catch (cause: unknown) {
      if (cause instanceof ProductApiError && cause.response.status === 409) {
        setGateDone((value) => value + 1);
        onChanged();
        return "settled";
      }
      const fault = await humanFaultWithCode(cause, notSaved.fault);
      setApprovalError(fault);
      return { fault };
    } finally {
      setApprovalBusy(false);
    }
  };
  // Resolves to the fault the person sees, or null once the decision stands.
  const onDecideApproval = async (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
  }): Promise<string | null> => {
    const saved = await saveDecision(decision);
    return typeof saved === "object" ? saved.fault : null;
  };
  // The person's words go with the decline as their reason; mailed instead when the ask could
  // not take them, so they are never lost and a failed mail says why.
  const declineWith =
    (approvalId: string) =>
    async (text: string): Promise<ChatMessage> => {
      const saved = await saveDecision({
        approvalId,
        choice: "no",
        message: deliveredText(text),
      });
      if (saved === "settled") return composer.post(text);
      if (typeof saved === "object") {
        // The composer reports the fault; the card keeps no second copy of it.
        setApprovalError(null);
        throw new Error(saved.fault);
      }
      return {
        id: `declined:${approvalId}`,
        author: "me",
        body: text,
        at: new Date().toISOString(),
      };
    };
  const openApproval = openApprovalOf(pendingApprovals);

  return {
    /** The open decisions; undefined until read. */
    waits,
    /** Who is at work, as the hub's activity read last saw it. */
    activity: activity.data,
    /** The runs held on an approval, as one string an effect can depend on. */
    awaitingApproval,
    settledApprovals,
    /** The approvals no one has decided yet; undefined until read. */
    pendingApprovals,
    openApprovalIds,
    openApproval,
    approvalBusy,
    approvalError,
    readPendingApprovals,
    onDecideApproval,
    declineWith,
  };
}
