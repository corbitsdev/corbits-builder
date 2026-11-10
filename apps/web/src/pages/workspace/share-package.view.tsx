/**
 * The add-reviewer form as it looks: who is asked to sign off on a package, in what role, what
 * they should focus on, and how long they have.
 */
import { Button, Switch } from "@corbits/react-ui";
import type { ExpiryPreset } from "@corbits-builder/schemas/approval-round";
import { InlineNote } from "../../components.jsx";
import { wording } from "../../config.ts";
import {
  ApprovalField,
  ApprovalFields,
  LeanInput,
  LeanSelect,
  PersonaFields,
  type ReviewerDraft,
} from "../approval-fields.tsx";
import styles from "./approval-rounds.module.css";

const roundText = wording.approvalRound;
const EXPIRY_OPTIONS: readonly ExpiryPreset[] = ["24h", "7d", "30d"];

/** A reviewer being entered, one of the form's rows. */
export type NewReviewer = ReviewerDraft & {
  key: string;
  /** The saved reviewer the fields were filled from; "" when they were typed. */
  savedReviewer: string;
  /** Whether to save them for other projects; null for one who is already saved. */
  saveToWorkspace: boolean | null;
};

export type SharePackageViewProps = {
  reviewers: readonly NewReviewer[];
  /** The reviewers saved for every project; the picker is absent when there are none. */
  savedReviewers: readonly { id: string; name: string; persona: string }[];
  /** The personas the list offers. */
  personas: readonly string[];
  /** How long the reviewers have to answer. */
  expiry: ExpiryPreset;
  onExpiryChange: (expiry: ExpiryPreset) => void;
  /** The hub is adding the reviewers. */
  adding: boolean;
  /** Every reviewer has a name and a persona. */
  canAdd: boolean;
  onReviewerChange: (key: string, reviewer: ReviewerDraft) => void;
  onPickSavedReviewer: (key: string, savedReviewer: string) => void;
  /** Keeps the typed persona in the list for next time. */
  onCommitCustomPersona: (key: string) => void;
  onSaveToWorkspaceChange: (key: string, save: boolean) => void;
  onAdd: () => void;
  onCancel: () => void;
};

export function SharePackageView({
  reviewers,
  savedReviewers,
  personas,
  expiry,
  onExpiryChange,
  adding,
  canAdd,
  onReviewerChange,
  onPickSavedReviewer,
  onCommitCustomPersona,
  onSaveToWorkspaceChange,
  onAdd,
  onCancel,
}: SharePackageViewProps) {
  return (
    <div
      className={styles.shareDialog}
      role="dialog"
      aria-label={roundText.dialogTitle}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className={styles.shareReviewers}>
        {reviewers.map((reviewer, index) => {
          const rowLabel = roundText.reviewerRowLabel(index + 1);
          const change = (next: ReviewerDraft) =>
            onReviewerChange(reviewer.key, next);
          return (
            <ApprovalFields
              key={reviewer.key}
              variant="form"
              role="group"
              aria-label={rowLabel}
            >
              {savedReviewers.length === 0 ? null : (
                <ApprovalField label={roundText.fieldLabels.saved}>
                  <LeanSelect
                    aria-label={`${rowLabel} ${roundText.workspaceReviewerLabel}`}
                    value={reviewer.savedReviewer}
                    onChange={(event) =>
                      onPickSavedReviewer(reviewer.key, event.target.value)
                    }
                  >
                    <option value="">
                      {roundText.workspaceReviewerPlaceholder}
                    </option>
                    {savedReviewers.map((saved) => (
                      <option key={saved.id} value={saved.id}>
                        {roundText.workspaceReviewerOption(
                          saved.name,
                          saved.persona,
                        )}
                      </option>
                    ))}
                  </LeanSelect>
                </ApprovalField>
              )}
              <ApprovalField label={roundText.fieldLabels.name}>
                <LeanInput
                  aria-label={`${rowLabel} ${roundText.reviewerName}`}
                  placeholder={roundText.reviewerNamePlaceholder}
                  value={reviewer.name}
                  onChange={(event) =>
                    change({ ...reviewer, name: event.target.value })
                  }
                />
              </ApprovalField>
              <PersonaFields
                reviewer={reviewer}
                onChange={change}
                personas={personas}
                label={rowLabel}
                placeholder={roundText.reviewerPersonaPlaceholder}
                onKeepCustomPersona={() => onCommitCustomPersona(reviewer.key)}
              />
              <ApprovalField label={roundText.fieldLabels.focus}>
                <LeanInput
                  aria-label={`${rowLabel} ${roundText.reviewerGoal}`}
                  placeholder={roundText.reviewerGoalPlaceholder}
                  value={reviewer.goal}
                  onChange={(event) =>
                    change({ ...reviewer, goal: event.target.value })
                  }
                />
              </ApprovalField>
              <ApprovalField label={roundText.fieldLabels.email}>
                <LeanInput
                  type="email"
                  aria-label={`${rowLabel} ${roundText.reviewerEmail}`}
                  placeholder={roundText.reviewerEmailPlaceholder}
                  value={reviewer.email}
                  onChange={(event) =>
                    change({ ...reviewer, email: event.target.value })
                  }
                />
              </ApprovalField>
              {reviewer.saveToWorkspace === null ? null : (
                <ApprovalField
                  label={roundText.fieldLabels.workspace}
                  title={roundText.saveToWorkspaceTooltip}
                >
                  <div className={styles.saveToggle}>
                    <Switch
                      label={roundText.saveToWorkspaceLabel(
                        reviewer.name.trim(),
                      )}
                      checked={reviewer.saveToWorkspace}
                      onCheckedChange={(checked) =>
                        onSaveToWorkspaceChange(reviewer.key, checked)
                      }
                    />
                    <InlineNote as="span">
                      {roundText.saveToWorkspaceNote}
                    </InlineNote>
                  </div>
                </ApprovalField>
              )}
              <ApprovalField label={roundText.fieldLabels.expires}>
                <LeanSelect
                  aria-label={roundText.expiryLabel}
                  value={expiry}
                  onChange={(event) =>
                    onExpiryChange(event.target.value as ExpiryPreset)
                  }
                >
                  {EXPIRY_OPTIONS.map((preset) => (
                    <option key={preset} value={preset}>
                      {roundText.expiry[preset]}
                    </option>
                  ))}
                </LeanSelect>
              </ApprovalField>
            </ApprovalFields>
          );
        })}
      </div>
      <div className={styles.shareActions}>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {roundText.cancelShare}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={adding || !canAdd}
          onClick={onAdd}
        >
          {adding ? roundText.startingRound : roundText.shareSubmitButton}
        </Button>
      </div>
    </div>
  );
}
