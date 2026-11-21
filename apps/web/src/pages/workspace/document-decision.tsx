/**
 * The person's decision on a pending approval, as the library's ToolApproval,
 * named by the tool that asked and its main argument. Approve records the
 * existing approve call; Not yet records a denial and takes the person to the
 * composer to say what to change.
 */
import { useContext, type ReactNode } from "react";
import { wording } from "../../config.ts";
import {
  Button,
  ToolApproval,
  type ToolApprovalDecision,
} from "@corbits/react-ui";
import { ActionsSlot } from "@corbits-builder/plugin-ui/screen-actions";
import {
  approvalQuestion,
  approvalToolPart,
  runsShell,
} from "./collaboration.ts";
import type { ApprovalOutcome, DocumentApproval } from "./transcript.tsx";
import styles from "./document-decision.module.css";

const text = wording.approval;

function settledLine(approval: DocumentApproval): string {
  return text.approved(
    approval.toolName === undefined
      ? text.settledUnnamed
      : approvalQuestion(approval.toolName, approval.subject),
  );
}

function settledTitle(approval: DocumentApproval): string | undefined {
  if (approval.outcome?.status === "approved") return settledLine(approval);
  if (approval.outcome?.status === "rejected") return text.declined;
  return undefined;
}

export function DocumentDecision({
  approval,
  disabled = false,
  error,
  onYes,
  onNo,
  countdown,
  place = "conversation",
}: {
  approval: DocumentApproval;
  disabled?: boolean;
  error?: string;
  onYes: () => void;
  onAlways: () => void;
  onNo: () => void;
  /** A typed yes about to approve this card. */
  countdown?: ReactNode;
  /** In the conversation, or inside the prompt box above the words. */
  place?: "conversation" | "box";
}) {
  const slot = useContext(ActionsSlot);
  // Waiting in the prompt box, the ask heads the card with Not yet beside it, what would run sits
  // beneath, and Yes stands where Send is. The library's card keeps its buttons inside it, so the
  // box draws the ask itself. Only a shell run's subject is a command line, so only it reads as
  // one; any other tool's subject is what it would touch, said plainly under the tool's ask.
  if (place === "box" && approval.outcome === undefined) {
    const shell =
      runsShell(approval.toolName) && approval.subject !== undefined;
    const ask = shell ? text.run : approvalQuestion(approval.toolName);
    const yes = (
      <div className={styles.answers} inert={disabled}>
        <Button type="button" size="sm" onClick={onYes}>
          {text.approve}
        </Button>
      </div>
    );
    return (
      <section className={styles.inBox} aria-label={ask}>
        <header className={styles.head}>
          <p className={styles.ask}>{ask}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.notYet}
            disabled={disabled}
            onClick={onNo}
          >
            {text.notYet}
          </Button>
        </header>
        {approval.subject === undefined ? null : shell ? (
          <pre className={styles.command}>
            <code>
              <span className={styles.prompt} aria-hidden>
                {text.shellPrompt}
              </span>
              {approval.subject}
            </code>
          </pre>
        ) : (
          <p className={styles.subject}>{approval.subject}</p>
        )}
        {countdown}
        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {slot === null ? yes : slot(yes)}
      </section>
    );
  }
  const decide = (decision: ToolApprovalDecision) => {
    if (decision.outcome === "rejected") onNo();
    else onYes();
  };
  const title = settledTitle(approval);
  return (
    <ToolApproval
      className={styles.decision}
      data-once=""
      part={approvalToolPart(approval.approvalId, approval.outcome)}
      onDecide={decide}
      disabled={disabled}
      {...(error === undefined ? {} : { error })}
      {...(title === undefined ? {} : { title })}
      labels={{
        title: approvalQuestion(approval.toolName, approval.subject),
        approve: text.approve,
        deny: text.notYet,
        approvedOnce: settledLine(approval),
        approvedAlways: text.always(settledLine(approval)),
        denied: text.declined,
      }}
    >
      {countdown}
    </ToolApproval>
  );
}

/** The person's decision on packages the coder asks to install, this once or for the whole build. */
export function PackageDecision({
  approvalId,
  packages,
  outcome,
  disabled = false,
  error,
  onYes,
  onAlways,
  onNo,
  countdown,
}: {
  approvalId: string;
  packages: readonly string[];
  outcome?: ApprovalOutcome;
  disabled?: boolean;
  error?: string;
  onYes: () => void;
  onAlways: () => void;
  onNo: () => void;
  /** A typed yes about to approve this card. */
  countdown?: ReactNode;
}) {
  const decide = (decision: ToolApprovalDecision) => {
    if (decision.outcome === "rejected") onNo();
    else if (decision.scope === "always") onAlways();
    else onYes();
  };
  return (
    <ToolApproval
      className={styles.decision}
      part={approvalToolPart(approvalId, outcome)}
      onDecide={decide}
      disabled={disabled}
      {...(error === undefined ? {} : { error })}
      labels={{
        title: text.packages(packages.join(", ")),
        approve: text.approve,
        approveAlways: text.packagesAlways,
        deny: text.decline,
        approvedOnce: text.packagesAllowed(packages.join(", ")),
        approvedAlways: text.always(text.packagesAllowed(packages.join(", "))),
        denied: text.packagesDeclined(packages.join(", ")),
      }}
    >
      <p className={styles.next}>{text.packagesDetail}</p>
      {countdown}
    </ToolApproval>
  );
}
