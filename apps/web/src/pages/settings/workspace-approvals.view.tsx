/**
 * The workspace approvals section as it looks: the switch that turns stakeholder approval on,
 * the reviewers saved for every project, and the fields that add one.
 */
import { Section, Switch } from "@corbits/react-ui";
import { InlineNote } from "../../components.tsx";
import { wording } from "../../config.ts";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import { SettingsSectionBody, SettingsSubhead } from "./settings-section.tsx";
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
  /** Projects use stakeholder approval packages. */
  required: boolean;
  onRequiredChange: (required: boolean) => void;
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
  /** The reviewer has a name and a persona, so they can be saved. */
  canAdd: boolean;
  onAddReviewer: () => void;
};

export function WorkspaceApprovalsView({
  required,
  onRequiredChange,
  reviewers,
  onRemoveReviewer,
  personas,
  reviewer,
  onReviewerChange,
  canAdd,
  onAddReviewer,
}: WorkspaceApprovalsViewProps) {
  const copy = wording.settings.approvals;
  const roundCopy = wording.approvalRound;
  return (
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        <SettingsRow
          label={copy.requireLabel}
          hint={copy.requireHint}
          htmlFor="workspace-approvals-enabled"
        >
          <Switch
            id="workspace-approvals-enabled"
            checked={required}
            onCheckedChange={onRequiredChange}
          />
        </SettingsRow>
        <SettingsSubhead>{copy.reviewersSubhead}</SettingsSubhead>
        <p>{copy.reviewersLead}</p>
        {reviewers.length === 0 ? (
          <InlineNote>{copy.emptyReviewers}</InlineNote>
        ) : (
          reviewers.map((saved) => {
            const hintParts = [saved.goal, saved.email].filter(
              (part): part is string => part !== undefined && part !== "",
            );
            return (
              <SettingsRow
                key={saved.id}
                label={saved.name}
                {...(hintParts.length === 0
                  ? {}
                  : { hint: hintParts.join(" · ") })}
              >
                <SettingsRowValue>
                  <InlineNote as="span">{saved.persona}</InlineNote>
                  <LeanButton onClick={() => onRemoveReviewer(saved.id)}>
                    {copy.removeReviewer}
                  </LeanButton>
                </SettingsRowValue>
              </SettingsRow>
            );
          })
        )}
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
      </SettingsSectionBody>
    </Section>
  );
}
