/**
 * The person's decision on a pending approval, as the library's ToolApproval.
 * It names the document open on the right, at the version shown there.
 * Approve records the existing approve call; Not yet records a denial and
 * takes the person to the composer to say what to change.
 * Tool names and a writer's instruction never reach the card. A coder
 * instruction is what the person approves, so it does. The designer starts
 * from the documents the card lists, so its instruction stays folded.
 */
import type { ReactNode } from "react";
import { wording } from "../../config.ts";
import {
  Badge,
  Button as UiButton,
  ToolApproval,
  type ToolApprovalDecision,
} from "@corbits/react-ui";
import { approvalQuestion, shortDocumentName } from "./collaboration.ts";
import { approvalToolPart } from "./conversation-parts.ts";
import type { ApprovalOutcome, DocumentApproval } from "./transcript.tsx";

const text = wording.approval;
const INSTRUCTION_ASKS = new Set(["instruct_coder"]);
const FOLDED_INSTRUCTION_ASKS = new Set(["design_app"]);
// Asks that record no approval of document versions, where the native standing
// grant only lets later calls in the run go ahead. Every other card records an
// approval of the exact versions shown, so it hides the library's Approve always.
const STANDING_ASKS = new Set(["design_app"]);

function shortName(approval: DocumentApproval): string | undefined {
  const { document } = approval;
  return document === undefined
    ? undefined
    : shortDocumentName(document.kind, document.title);
}

// The documents a request_approval ask approves together, when it covers more than one.
export function approvedTogether(approval: DocumentApproval) {
  return approval.toolName === "request_approval"
    ? approval.sources
    : undefined;
}

function decisionTitle(approval: DocumentApproval, shown: boolean): string {
  const together = approvedTogether(approval);
  if (together !== undefined)
    return text.documents(
      together.map(({ kind, title }) => shortDocumentName(kind, title)),
    );
  const question = approvalQuestion(
    approval.toolName,
    shortName(approval) ?? "",
    approval.subject,
  );
  return shown ? `${question} ${text.openOnRight}` : question;
}

function bodyLine(approval: DocumentApproval): string | undefined {
  const last = approval.document ?? approvedTogether(approval)?.at(-1);
  const next = last === undefined ? undefined : text.nextDocument[last.kind];
  if (next !== undefined) return text.next(next);
  return approval.toolName === undefined
    ? undefined
    : text.body[approval.toolName];
}

/** What exactly the person approves, and who made it. */
function approvingLine(approval: DocumentApproval): string | undefined {
  const { document } = approval;
  if (document !== undefined)
    return text.approving.document(
      document.title,
      document.version,
      text.writtenBy[document.kind] ?? text.writer,
    );
  if (approvedTogether(approval) !== undefined) return text.approving.documents;
  const tool = approval.toolName;
  return tool === "design_app" || tool === "instruct_coder"
    ? text.approving[tool]
    : undefined;
}

// A declined ask records no versions, so its line names the documents without one.
function declinedLine(approval: DocumentApproval): string {
  const named =
    approval.document === undefined
      ? (approvedTogether(approval) ?? [])
      : [approval.document];
  return text.declined(
    named.length === 0 ? undefined : named.map(({ title }) => title).join(", "),
  );
}

function settledLine(approval: DocumentApproval): string {
  const { document } = approval;
  if (document !== undefined)
    return text.approved(`${document.title} v${String(document.version)}`);
  const together = approvedTogether(approval);
  if (together !== undefined)
    return text.approved(
      together
        .map(({ title, version }) => `${title} v${String(version)}`)
        .join(", "),
    );
  const settled =
    approval.toolName === undefined
      ? undefined
      : text.settled[approval.toolName];
  return text.approved(
    settled ?? approvalQuestion(approval.toolName, "", approval.subject),
  );
}

export function DocumentDecision({
  approval,
  shownDocument,
  onShowDocument,
  disabled = false,
  error,
  onYes,
  onAlways,
  onNo,
  countdown,
}: {
  approval: DocumentApproval;
  /** The document the reading pane shows, by kind. */
  shownDocument?: string | null;
  /** Takes the reading pane to that document. */
  onShowDocument?: (kind: string) => void;
  disabled?: boolean;
  error?: string;
  onYes: () => void;
  onAlways: () => void;
  onNo: () => void;
  /** A typed yes about to approve this card. */
  countdown?: ReactNode;
}) {
  const body = bodyLine(approval);
  const approving = approvingLine(approval);
  const asked = approval.document;
  const shown = asked !== undefined && shownDocument === asked.kind;
  const name = shortName(approval);
  const together = approvedTogether(approval) !== undefined;
  const actions = (approval.toolName === undefined
    ? undefined
    : text.actions[approval.toolName]) ?? {
    approve: text.approve,
    deny: text.notYet,
  };
  const instruction = approval.instruction;
  const tool = approval.toolName ?? "";
  const standing = STANDING_ASKS.has(tool);
  const decide = (decision: ToolApprovalDecision) => {
    if (decision.outcome === "rejected") onNo();
    else if (standing && decision.scope === "always") onAlways();
    else onYes();
  };
  const sources = approval.sources ?? [];
  const sourceList =
    sources.length === 0 ? null : (
      <ul className="document-decision-sources">
        {sources.map((source) => (
          <li key={source.kind}>
            <UiButton
              type="button"
              variant="link"
              size="sm"
              className="document-decision-show"
              title={text.source(source.title, source.version)}
              disabled={onShowDocument === undefined}
              onClick={() => onShowDocument?.(source.kind)}
            >
              {together
                ? text.writtenSource(
                    source.title,
                    source.version,
                    text.writtenBy[source.kind] ?? text.writer,
                  )
                : text.source(source.title, source.version)}
            </UiButton>
          </li>
        ))}
      </ul>
    );
  return (
    <ToolApproval
      className={
        standing
          ? "document-decision"
          : "document-decision document-decision-once"
      }
      part={approvalToolPart(approval.approvalId, approval.outcome)}
      onDecide={decide}
      disabled={disabled}
      {...(error === undefined ? {} : { error })}
      {...(approval.outcome?.status === "approved"
        ? { title: settledLine(approval) }
        : approval.outcome?.status === "rejected"
          ? { title: declinedLine(approval) }
          : {})}
      labels={{
        title: decisionTitle(approval, shown),
        ...actions,
        approvedOnce: settledLine(approval),
        approvedAlways: text.always(settledLine(approval)),
        denied: declinedLine(approval),
      }}
    >
      {approving === undefined ? null : (
        <p className="document-decision-what">{approving}</p>
      )}
      {instruction !== undefined && INSTRUCTION_ASKS.has(tool) ? (
        <p>{instruction}</p>
      ) : null}
      {sources.length > 1 ? (
        <details className="document-decision-details">
          <summary>{text.covers(sources.length)}</summary>
          {sourceList}
        </details>
      ) : (
        sourceList
      )}
      {approval.concepts === undefined ||
      approval.concepts.length === 0 ? null : (
        <ul className="document-decision-concepts" aria-label={text.concepts}>
          {approval.concepts.map((concept) => (
            <li key={concept.label}>
              <Badge tone="neutral" title={concept.direction}>
                {concept.label}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {body === undefined ? null : (
        <p className="document-decision-next">{body}</p>
      )}
      {asked === undefined ||
      shown ||
      name === undefined ||
      onShowDocument === undefined ? null : (
        <UiButton
          type="button"
          variant="link"
          size="sm"
          className="document-decision-show"
          onClick={() => onShowDocument(asked.kind)}
        >
          {text.show(name)}
        </UiButton>
      )}
      {instruction !== undefined && FOLDED_INSTRUCTION_ASKS.has(tool) ? (
        <details className="document-decision-details">
          <summary>{text.details}</summary>
          <p>{instruction}</p>
        </details>
      ) : null}
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
      className="document-decision"
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
      <p className="document-decision-next">{text.packagesDetail}</p>
      {countdown}
    </ToolApproval>
  );
}
