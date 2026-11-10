/**
 * What the add-reviewer form does: holds the reviewers being entered, fills one from a reviewer
 * saved for the workspace, and starts the package's round with them, or adds them to it.
 */
import type {
  ApprovalRound,
  ExpiryPreset,
} from "@corbits-builder/schemas/approval-round";
import { useState } from "react";
import { startApprovalRound } from "../../api/artifacts.ts";
import { wording } from "../../config.ts";
import { queryClient } from "../../queries/client.ts";
import { keys } from "../../queries/keys.ts";
import {
  addCustomReviewerPersona,
  addWorkspaceReviewer,
  allReviewerPersonas,
  useCustomReviewerPersonas,
  useWorkspaceReviewers,
} from "../../workspace-approvals-setting.ts";
import type { ReviewerDraft } from "../approval-fields.tsx";
import { humanFault } from "./human-fault.ts";
import type { SharePackageViewProps } from "./share-package.view.tsx";

const roundText = wording.approvalRound;

export type SharePackageProps = {
  projectId: string;
  packageVersion: number;
  onCreated: (round: ApprovalRound) => void;
  onCancel: () => void;
  onFault: (message: string | null) => void;
};

/** One of the form's rows: the reviewer being entered, and the saved one it was filled from. */
type ReviewerRow = ReviewerDraft & {
  key: string;
  workspaceReviewerId?: string | undefined;
  saveToWorkspace: boolean;
};

/** The persona a reviewer goes by: the one typed, or else the one picked. */
function personaOf(reviewer: ReviewerDraft): string {
  return (reviewer.customPersona ?? reviewer.persona).trim();
}

export function useSharePackage({
  projectId,
  packageVersion,
  onCreated,
  onCancel,
  onFault,
}: SharePackageProps): SharePackageViewProps {
  const workspaceReviewers = useWorkspaceReviewers();
  const customPersonas = useCustomReviewerPersonas();
  const personaOptions = allReviewerPersonas(
    customPersonas,
    workspaceReviewers,
  );
  const [expiry, setExpiry] = useState<ExpiryPreset>("7d");
  const [reviewers, setReviewers] = useState<ReviewerRow[]>([
    {
      key: "reviewer-1",
      name: "",
      persona: "",
      customPersona: null,
      goal: "",
      email: "",
      saveToWorkspace: false,
    },
  ]);
  const [starting, setStarting] = useState(false);

  const changeReviewer = (
    rowKey: string,
    { name, persona, customPersona, goal, email }: ReviewerDraft,
  ) => {
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        return {
          ...entry,
          name,
          persona,
          customPersona,
          goal,
          email,
          // A reviewer whose name is retyped is no longer the saved one.
          ...(name === entry.name ? {} : { workspaceReviewerId: undefined }),
        };
      }),
    );
  };

  const selectWorkspaceReviewer = (rowKey: string, workspaceId: string) => {
    const match = workspaceReviewers.find((entry) => entry.id === workspaceId);
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        if (match === undefined) {
          return { ...entry, workspaceReviewerId: undefined };
        }
        return {
          ...entry,
          workspaceReviewerId: match.id,
          name: match.name,
          persona: match.persona,
          ...(match.email === undefined ? {} : { email: match.email }),
          ...(match.goal === undefined ? {} : { goal: match.goal }),
          customPersona: null,
          saveToWorkspace: false,
        };
      }),
    );
  };

  const commitCustomPersona = (rowKey: string) => {
    const target = reviewers.find((entry) => entry.key === rowKey);
    const trimmed = target?.customPersona?.trim();
    if (!trimmed) return;
    addCustomReviewerPersona(trimmed);
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        return { ...entry, persona: trimmed, customPersona: null };
      }),
    );
  };

  const setSaveToWorkspace = (rowKey: string, checked: boolean) => {
    setReviewers((current) =>
      current.map((entry) =>
        entry.key === rowKey ? { ...entry, saveToWorkspace: checked } : entry,
      ),
    );
  };

  const canStartRound =
    reviewers.length > 0 &&
    reviewers.every(
      (reviewer) => reviewer.name.trim() !== "" && personaOf(reviewer) !== "",
    );

  const handleStartRound = async () => {
    const valid = reviewers
      .map((reviewer) => ({
        name: reviewer.name.trim(),
        persona: personaOf(reviewer),
        ...(reviewer.email.trim() !== ""
          ? { email: reviewer.email.trim() }
          : {}),
        ...(reviewer.goal.trim() !== "" ? { goal: reviewer.goal.trim() } : {}),
        ...(reviewer.saveToWorkspace ? { saveToWorkspace: true } : {}),
      }))
      .filter((reviewer) => reviewer.name !== "" && reviewer.persona !== "");
    if (valid.length === 0) return;
    for (const reviewer of valid) {
      addCustomReviewerPersona(reviewer.persona);
      if (reviewer.saveToWorkspace === true) {
        addWorkspaceReviewer({
          name: reviewer.name,
          persona: reviewer.persona,
          ...(reviewer.email === undefined ? {} : { email: reviewer.email }),
          ...(reviewer.goal === undefined ? {} : { goal: reviewer.goal }),
        });
      }
    }
    setStarting(true);
    onFault(null);
    try {
      const created = await startApprovalRound(projectId, {
        packageVersion,
        expiry,
        reviewers: valid,
      });
      void queryClient.invalidateQueries({
        queryKey: keys.projectRoom.of(projectId),
      });
      onCreated(created);
    } catch (error) {
      onFault(humanFault(error, roundText.failed));
    } finally {
      setStarting(false);
    }
  };

  return {
    reviewers: reviewers.map((reviewer) => ({
      key: reviewer.key,
      savedReviewer:
        reviewer.workspaceReviewerId === undefined
          ? ""
          : reviewer.workspaceReviewerId,
      name: reviewer.name,
      persona: reviewer.persona,
      customPersona: reviewer.customPersona,
      goal: reviewer.goal,
      email: reviewer.email,
      saveToWorkspace:
        reviewer.workspaceReviewerId === undefined
          ? reviewer.saveToWorkspace
          : null,
    })),
    savedReviewers: workspaceReviewers,
    personas: personaOptions,
    expiry,
    onExpiryChange: setExpiry,
    adding: starting,
    canAdd: canStartRound,
    onReviewerChange: changeReviewer,
    onPickSavedReviewer: selectWorkspaceReviewer,
    onCommitCustomPersona: commitCustomPersona,
    onSaveToWorkspaceChange: setSaveToWorkspace,
    onAdd: () => void handleStartRound(),
    onCancel,
  };
}
