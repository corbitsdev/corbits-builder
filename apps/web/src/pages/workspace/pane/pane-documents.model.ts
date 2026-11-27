/**
 * The documents the project view lists and the one it shows. The pane follows the newest version
 * filed while the room is open unless the person picked one since; a document that failed to read
 * can be read again, the version a viewer opened is kept in this browser, and approving the one
 * they read closes the project view on the conversation.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ProjectArtifact } from "@corbits-builder/client";
import { wording } from "../../../config.ts";
import { approveDocument } from "../../../api/artifacts.ts";
import { humanFault, humanFaultWithCode } from "../../../human-fault.ts";
import { usePreference } from "../../../queries/preferences.ts";
import type { DeliverableState } from "./deliverable-block.tsx";
import { conceptTab, DESIGN_OPTION } from "../design/design-concept.ts";
import { documentsForPane } from "./document-read.ts";
import { useFiledVersions } from "./filed-versions.ts";
import {
  paneDocumentKey,
  reloadProjectDocument,
  type RoomSnapshot,
} from "./load-room.ts";
import {
  paneArtifacts,
  paneDocument,
  shownDocument,
  tabbedArtifacts,
} from "./pane-documents.ts";
import { markSeen, useSeenVersions } from "./seen-versions.ts";
import {
  followDeliverableId,
  shownDeliverableId,
  type DocumentChoice,
} from "../tab-follow.ts";

export function usePaneDocuments({
  projectId,
  archived,
  snapshot,
  following,
  reload,
  onChanged,
  closeProject,
}: {
  projectId: string;
  archived: boolean;
  snapshot: RoomSnapshot;
  /** What the coordinator is doing, which the pane follows to the document it names. */
  following: { working: boolean; liveText: string };
  reload: () => void;
  onChanged: () => void;
  closeProject: () => void;
}) {
  const queryClient = useQueryClient();
  const artifacts = paneArtifacts(snapshot.artifacts);
  const documents = snapshot.documents;
  const shownDocuments = artifacts.map((item) =>
    shownDocument(item, documents[paneDocumentKey(projectId, item)]),
  );
  const stakeholderApprovals =
    usePreference("experimental_approvals") === "yes" ? "on" : "off";
  const seen = useSeenVersions();
  const [documentChoice, setDocumentChoice] = useState<DocumentChoice | null>(
    null,
  );
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const retryDocument = async (item: ProjectArtifact) => {
    const key = paneDocumentKey(projectId, item);
    if (documents[key]?.status !== "error") return;
    setRetryingKey(key);
    try {
      await reloadProjectDocument(projectId, key, queryClient, !archived);
    } catch (cause) {
      toast.error(humanFault(cause, wording.documentRetryFailed));
    } finally {
      setRetryingKey((current) => (current === key ? null : current));
    }
  };
  const documentState = (
    item: ProjectArtifact,
  ): DeliverableState | undefined => {
    const key = paneDocumentKey(projectId, item);
    if (retryingKey === key) return { status: "loading" };
    return documents[key];
  };
  const chooseDocument = (id: string) =>
    setDocumentChoice({ id, filedCount: filed.length });
  // The person approves the document they read; the next room read shows it approved. Approved,
  // it is done with, so the project view closes on the conversation.
  const approveRead = async (id: string, version: number) => {
    const item = paneDeliverables.find((entry) => entry.kind === id);
    if (item === undefined) return;
    try {
      await approveDocument(projectId, item.artifactId, version);
      closeProject();
      reload();
      onChanged();
    } catch (cause) {
      toast.error(
        await humanFaultWithCode(cause, wording.documentApproval.failed),
      );
    }
  };
  const paneDeliverables = documentsForPane(
    tabbedArtifacts(artifacts, stakeholderApprovals),
    documentState,
  );
  const markDocumentSeen = (id: string) => {
    const item = paneDeliverables.find((entry) => entry.kind === id);
    if (item !== undefined) markSeen(seen, item.artifactId, item.version);
  };
  const filed = useFiledVersions({
    projectId,
    documents: artifacts.map((item) =>
      item.kind === DESIGN_OPTION
        ? {
            kind: conceptTab(item.title),
            title: wording.design.conceptTitle(item.title),
            version: item.version,
          }
        : item,
    ),
  });
  const followId = followDeliverableId(
    paneDeliverables.map((item) => ({
      id: item.kind,
      title: item.title,
      filed: true,
    })),
    {
      filedDeliverableId: filed.at(-1)?.kind ?? null,
      working: following.working,
      liveText: following.liveText,
    },
  );
  const shownId = shownDeliverableId({
    choice: documentChoice,
    filedCount: filed.length,
    followId,
  });
  const selected =
    paneDeliverables.find((item) => item.kind === shownId) ?? null;
  const selectedState = selected === null ? undefined : documentState(selected);
  const paneDocuments = paneDeliverables.map((item) =>
    paneDocument(item, seen),
  );

  return {
    /** The project's filed documents and files, as the pane lists them. */
    artifacts,
    /** Each of those, with a summary once it reads as one. */
    shownDocuments,
    /** The version of each document this viewer last opened. */
    seen,
    documentState,
    /** The documents the project view gives a tab, with where each read stands. */
    paneDeliverables,
    paneDocuments,
    /** The document the pane shows; null while none. */
    selected,
    selectedState,
    chooseDocument,
    retryDocument,
    approveRead,
    markDocumentSeen,
  };
}
