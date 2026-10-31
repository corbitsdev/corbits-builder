/**
 * Approvals no longer pending, as their native records settled them, so a
 * decided card keeps its place and outcome in the thread across reloads and
 * decisions made elsewhere. A card names the document versions the hub
 * recorded the approval covering, never the current ones; a declined ask
 * records none, so it names the documents its arguments asked about. A
 * decision made here shows at once, until the record read afterwards confirms it.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ProjectArtifact } from "@corbits-builder/client";
import type { DecidedApproval } from "@corbits-builder/schemas/artifact";
import { keys } from "../../queries/keys.ts";
import { askOf } from "../../api/ask.ts";
import { readDecidedApprovals } from "../../api/activity.ts";
import { cardDocuments } from "./collaboration.ts";
import { humanFault } from "./human-fault.ts";
import type { ApprovalOutcome, DocumentApproval } from "./transcript.tsx";

export type OpenApproval = DocumentApproval & { readonly tenantId: string };

function settledCard(
  record: DecidedApproval,
  artifacts: readonly ProjectArtifact[],
  decidedHere: DocumentApproval | undefined,
): DocumentApproval {
  const outcome: ApprovalOutcome = {
    status: record.status,
    ...(record.scope === null ? {} : { scope: record.scope }),
  };
  if (decidedHere !== undefined) return { ...decidedHere, outcome };
  const recorded = artifacts.flatMap((item) => {
    const approved = record.documents.find((ref) => ref.kind === item.kind);
    return approved === undefined
      ? []
      : [{ ...item, version: approved.version }];
  });
  const ask = askOf(record.toolName, record.toolArguments);
  const at = Date.parse(record.createdAt);
  return {
    approvalId: record.approvalId,
    ...(Number.isNaN(at) ? {} : { at }),
    ...cardDocuments(ask, record.status === "approved" ? recorded : artifacts),
    ...ask,
    outcome,
  };
}

export function useSettledApprovals(
  projectId: string,
  open: readonly OpenApproval[],
  artifacts: readonly ProjectArtifact[],
): {
  settled: readonly DocumentApproval[];
  settle: (approval: OpenApproval, outcome: ApprovalOutcome) => void;
} {
  const queryClient = useQueryClient();
  const queryKey = keys.decidedApprovals.of(projectId);
  const decided = useQuery({
    queryKey,
    queryFn: ({ signal }) => readDecidedApprovals(projectId, signal),
    refetchOnWindowFocus: false,
  });
  const [decidedHere, setDecidedHere] = useState<
    ReadonlyMap<string, DocumentApproval>
  >(new Map());
  useEffect(() => {
    setDecidedHere(new Map());
  }, [projectId]);

  // An ask that leaves the pending list was decided, here or elsewhere.
  const openKey = open.map((approval) => approval.approvalId).join("\n");
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [projectId, openKey]);

  useEffect(() => {
    if (decided.error !== null)
      toast.error(
        humanFault(decided.error, "Decided approvals could not be read."),
        { id: `approvals-read:${projectId}` },
      );
  }, [decided.error]);

  const records = decided.data?.approvals ?? [];
  const settled = [
    ...records.map((record) =>
      settledCard(record, artifacts, decidedHere.get(record.approvalId)),
    ),
    ...[...decidedHere.values()].filter(
      (card) =>
        !records.some((record) => record.approvalId === card.approvalId),
    ),
  ];

  return {
    settled,
    settle: ({ tenantId: _tenantId, ...card }, outcome) => {
      setDecidedHere((current) =>
        new Map(current).set(card.approvalId, { ...card, outcome }),
      );
      void queryClient.invalidateQueries({ queryKey });
    },
  };
}
