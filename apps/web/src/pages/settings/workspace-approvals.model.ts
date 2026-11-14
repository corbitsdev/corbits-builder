/**
 * What the saved reviewers do: reads and writes the reviewers this browser keeps, and holds the
 * reviewer being entered in the dialog until it is added.
 */
import { useState } from "react";
import { wording } from "../../config.ts";
import {
  addCustomReviewerPersona,
  addWorkspaceReviewer,
  allReviewerPersonas,
  removeWorkspaceReviewer,
  useCustomReviewerPersonas,
  useWorkspaceReviewers,
} from "../../workspace-approvals-setting.ts";
import type { ReviewerDraft } from "../approval-fields.tsx";
import type { WorkspaceApprovalsViewProps } from "./workspace-approvals.view.tsx";

export function useWorkspaceApprovals(): WorkspaceApprovalsViewProps {
  const reviewers = useWorkspaceReviewers();
  const customPersonas = useCustomReviewerPersonas();
  const [adding, setAdding] = useState(false);
  const [reviewer, setReviewer] = useState<ReviewerDraft>({
    name: "",
    persona: wording.approvalRound.reviewerPersonas[0],
    customPersona: null,
    goal: "",
    email: "",
  });

  const effectivePersona = (reviewer.customPersona ?? reviewer.persona).trim();
  const canAdd = reviewer.name.trim().length > 0 && effectivePersona.length > 0;

  const addReviewer = () => {
    if (!canAdd) return;
    if (reviewer.customPersona !== null) {
      addCustomReviewerPersona(effectivePersona);
    }
    const trimmedEmail = reviewer.email.trim();
    const trimmedGoal = reviewer.goal.trim();
    addWorkspaceReviewer({
      name: reviewer.name.trim(),
      persona: effectivePersona,
      ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
      ...(trimmedGoal.length > 0 ? { goal: trimmedGoal } : {}),
    });
    // The next reviewer starts on the persona this one had, typed or picked.
    setReviewer({
      name: "",
      persona:
        reviewer.customPersona === null ? reviewer.persona : effectivePersona,
      customPersona: null,
      goal: "",
      email: "",
    });
    setAdding(false);
  };

  return {
    reviewers,
    onRemoveReviewer: removeWorkspaceReviewer,
    personas: allReviewerPersonas(customPersonas, reviewers),
    reviewer,
    onReviewerChange: setReviewer,
    adding,
    onAddingChange: setAdding,
    canAdd,
    onAddReviewer: addReviewer,
  };
}
