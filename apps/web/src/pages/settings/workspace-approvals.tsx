import { Section, Switch } from "@corbits/react-ui";
import { useState } from "react";
import { InlineNote } from "../../components.tsx";
import { wording } from "../../config.ts";
import {
  addCustomReviewerPersona,
  addWorkspaceReviewer,
  allReviewerPersonas,
  removeWorkspaceReviewer,
  useCustomReviewerPersonas,
  useWorkspaceApprovalsEnabled,
  useWorkspaceReviewers,
  writeWorkspaceApprovalsEnabled,
} from "../../workspace-approvals-setting.ts";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import { SettingsSectionBody, SettingsSubhead } from "./settings-section.tsx";
import {
  ApprovalField,
  ApprovalFields,
  FieldSaveButton,
  LeanButton,
  LeanInput,
  LeanSelect,
} from "../approval-fields.tsx";
import styles from "./workspace-approvals.module.css";

const OTHER_PERSONA_OPTION = "__other__";

/** Workspace-level approval toggle and saved workspace reviewers. */
export function WorkspaceApprovals() {
  const approvalsEnabled = useWorkspaceApprovalsEnabled();
  const reviewers = useWorkspaceReviewers();
  const customPersonas = useCustomReviewerPersonas();
  const personaOptions = allReviewerPersonas(customPersonas, reviewers);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState<string>(
    wording.approvalRound.reviewerPersonas[0],
  );
  const [customPersonaOpen, setCustomPersonaOpen] = useState(false);
  const [customPersonaDraft, setCustomPersonaDraft] = useState("");
  const [email, setEmail] = useState("");
  const [goal, setGoal] = useState("");
  const copy = wording.settings.approvals;
  const roundCopy = wording.approvalRound;

  const effectivePersona = customPersonaOpen
    ? customPersonaDraft.trim()
    : persona.trim();
  const canAdd = name.trim().length > 0 && effectivePersona.length > 0;

  const handleSelectPersona = (value: string) => {
    if (value === OTHER_PERSONA_OPTION) {
      setCustomPersonaOpen(true);
      setCustomPersonaDraft("");
      return;
    }
    setCustomPersonaOpen(false);
    setPersona(value);
  };

  const handleAddReviewer = () => {
    if (!canAdd) return;
    if (customPersonaOpen) {
      addCustomReviewerPersona(effectivePersona);
    }
    const trimmedEmail = email.trim();
    const trimmedGoal = goal.trim();
    addWorkspaceReviewer({
      name: name.trim(),
      persona: effectivePersona,
      ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
      ...(trimmedGoal.length > 0 ? { goal: trimmedGoal } : {}),
    });
    setName("");
    setEmail("");
    setGoal("");
    if (customPersonaOpen) {
      setPersona(effectivePersona);
      setCustomPersonaOpen(false);
      setCustomPersonaDraft("");
    }
  };

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
            checked={approvalsEnabled === "on"}
            onCheckedChange={(on) =>
              writeWorkspaceApprovalsEnabled(on ? "on" : "off")
            }
          />
        </SettingsRow>
        <SettingsSubhead>{copy.reviewersSubhead}</SettingsSubhead>
        <p>{copy.reviewersLead}</p>
        {reviewers.length === 0 ? (
          <InlineNote>{copy.emptyReviewers}</InlineNote>
        ) : (
          reviewers.map((reviewer) => {
            const hintParts = [reviewer.goal, reviewer.email].filter(
              (part): part is string => part !== undefined && part !== "",
            );
            return (
              <SettingsRow
                key={reviewer.id}
                label={reviewer.name}
                {...(hintParts.length === 0
                  ? {}
                  : { hint: hintParts.join(" · ") })}
              >
                <SettingsRowValue>
                  <InlineNote as="span">{reviewer.persona}</InlineNote>
                  <LeanButton
                    onClick={() => removeWorkspaceReviewer(reviewer.id)}
                  >
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
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </ApprovalField>
          <ApprovalField label={roundCopy.fieldLabels.role}>
            <LeanSelect
              aria-label={copy.reviewerPersona}
              value={customPersonaOpen ? OTHER_PERSONA_OPTION : persona}
              onChange={(event) => handleSelectPersona(event.target.value)}
            >
              {personaOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={OTHER_PERSONA_OPTION}>
                {roundCopy.otherPersona}
              </option>
            </LeanSelect>
          </ApprovalField>
          {customPersonaOpen ? (
            <ApprovalField label={roundCopy.customPersonaLabel}>
              <LeanInput
                aria-label={roundCopy.customPersonaLabel}
                placeholder={roundCopy.customPersonaPlaceholder}
                value={customPersonaDraft}
                onChange={(event) => setCustomPersonaDraft(event.target.value)}
              />
            </ApprovalField>
          ) : null}
          <ApprovalField label={roundCopy.fieldLabels.focus}>
            <LeanInput
              aria-label={copy.reviewerGoal}
              placeholder={copy.reviewerGoal}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </ApprovalField>
          <ApprovalField label={wording.settings.account.email}>
            <LeanInput
              aria-label={copy.reviewerEmail}
              placeholder={copy.reviewerEmail}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </ApprovalField>
          <div className={styles.formActions}>
            <FieldSaveButton disabled={!canAdd} onClick={handleAddReviewer}>
              {copy.addReviewer}
            </FieldSaveButton>
          </div>
        </ApprovalFields>
      </SettingsSectionBody>
    </Section>
  );
}
