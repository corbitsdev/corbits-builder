/**
 * The person's decision on a pending approval, as the library's ToolApproval,
 * named by the tool that asked and its main argument. Approve records the
 * existing approve call; Not yet records a denial and takes the person to the
 * composer to say what to change.
 */
import type { ReactNode } from "react";
import { wording } from "../../config.ts";
import { ToolApproval, type ToolApprovalDecision } from "@corbits/react-ui";
import { approvalQuestion, approvalToolPart } from "./collaboration.ts";
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

export function DocumentDecision({
  approval,
  disabled = false,
  error,
  onYes,
  onNo,
  countdown,
}: {
  approval: DocumentApproval;
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
    else onYes();
  };
  return (
    <ToolApproval
      className={styles.decision}
      data-once=""
      part={approvalToolPart(approval.approvalId, approval.outcome)}
      onDecide={decide}
      disabled={disabled}
      {...(error === undefined ? {} : { error })}
      {...(approval.outcome?.status === "approved"
        ? { title: settledLine(approval) }
        : approval.outcome?.status === "rejected"
          ? { title: text.declined }
          : {})}
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
