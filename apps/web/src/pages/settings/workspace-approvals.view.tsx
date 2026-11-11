/**
 * The saved reviewers as they look: a row saying who is saved, each reviewer under it, and a
 * dialog with the fields that add one.
 */
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { Button, InlineNote } from "../../components.tsx";
import { wording } from "../../config.ts";
import { SettingsRow } from "./settings-row.tsx";
import {
  ApprovalField,
  ApprovalFields,
  FieldSaveButton,
  LeanButton,
  LeanInput,
  PersonaFields,
  type ReviewerDraft,
} from "../approval-fields.tsx";
import styles from "./workspace-approvals.module.css";

export type WorkspaceApprovalsViewProps = {
  /** The reviewers saved for every project. */
  reviewers: readonly {
    id: string;
    name: string;
    persona: string;
    goal?: string;
    email?: string;
  }[];
  onRemoveReviewer: (id: string) => void;
  /** The personas the list offers. */
  personas: readonly string[];
  /** The reviewer being entered. */
  reviewer: ReviewerDraft;
  onReviewerChange: (reviewer: ReviewerDraft) => void;
  /** The dialog that adds a reviewer is open. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  /** The reviewer has a name and a persona, so they can be saved. */
  canAdd: boolean;
  onAddReviewer: () => void;
};

export function WorkspaceApprovalsView({
  reviewers,
  onRemoveReviewer,
  personas,
  reviewer,
  onReviewerChange,
  adding,
  onAddingChange,
  canAdd,
  onAddReviewer,
}: WorkspaceApprovalsViewProps) {
  const copy = wording.settings.approvals;
  const roundCopy = wording.approvalRound;
  return (
    <>
      <SettingsRow
        layout="columns"
        label={copy.reviewers}
        hint={reviewers.length === 0 ? copy.emptyReviewers : copy.reviewersHint}
      >
        <Button onClick={() => onAddingChange(true)}>{copy.addReviewer}</Button>
      </SettingsRow>
      {reviewers.map((saved) => {
        const hintParts = [saved.goal, saved.email].filter(
          (part): part is string => part !== undefined && part !== "",
        );
        return (
          <SettingsRow
            key={saved.id}
            layout="columns"
            label={saved.name}
            {...(hintParts.length === 0 ? {} : { hint: hintParts.join(" · ") })}
          >
            <InlineNote as="span">{saved.persona}</InlineNote>
            <LeanButton onClick={() => onRemoveReviewer(saved.id)}>
              {copy.removeReviewer}
            </LeanButton>
          </SettingsRow>
        );
      })}
      <Dialog open={adding} onOpenChange={onAddingChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.dialogTitle}</DialogTitle>
            <DialogDescription>{copy.dialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ApprovalFields variant="form" separated>
              <ApprovalField label={roundCopy.fieldLabels.name}>
                <LeanInput
                  aria-label={copy.reviewerName}
                  placeholder={copy.reviewerName}
                  value={reviewer.name}
                  onChange={(event) =>
                    onReviewerChange({ ...reviewer, name: event.target.value })
                  }
                />
              </ApprovalField>
              <PersonaFields
                reviewer={reviewer}
                onChange={onReviewerChange}
                personas={personas}
              />
              <ApprovalField label={roundCopy.fieldLabels.focus}>
                <LeanInput
                  aria-label={copy.reviewerGoal}
                  placeholder={copy.reviewerGoal}
                  value={reviewer.goal}
                  onChange={(event) =>
                    onReviewerChange({ ...reviewer, goal: event.target.value })
                  }
                />
              </ApprovalField>
              <ApprovalField label={wording.settings.account.email}>
                <LeanInput
                  aria-label={copy.reviewerEmail}
                  placeholder={copy.reviewerEmail}
                  value={reviewer.email}
                  onChange={(event) =>
                    onReviewerChange({ ...reviewer, email: event.target.value })
                  }
                />
              </ApprovalField>
              <div className={styles.formActions}>
                <FieldSaveButton disabled={!canAdd} onClick={onAddReviewer}>
                  {copy.addReviewer}
                </FieldSaveButton>
              </div>
            </ApprovalFields>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
