import { type } from "arktype";

/**
 * The kinds of external control signal an agent can suspend on and later
 * resume from. Exposed as both an arktype validator (so members are
 * iterable and can be composed into wire validators) and a derived
 * TypeScript union.
 */
export const signalKinds = ["approval"] as const;
export const SignalKind = type.enumerated(...signalKinds);
export type SignalKind = typeof SignalKind.infer;

/**
 * The internal resumption taxonomy: how a parked run resumes, keyed by
 * (`kind`, `outcome`). This is NOT the approver's wire decision -- that is
 * `ApprovalDecision`, which the delivery path parses. `ControlSignal` is the
 * `kind`-discriminated union the resumption dispatch is designed around;
 * `correlationId` ties an entry back to the suspension it resolves and
 * `payload` carries kind-specific data opaquely. It is intentionally ahead of
 * its consumers: the `approval` arm is the only one wired today, and its
 * `timeout` outcome arrives via the gate-timeout path, not as a delivered
 * decision. Each remaining signal flow activates its own arm as it lands.
 */
export const ControlSignal = type({
  correlationId: "string",
  kind: "'approval'",
  outcome: "'approved' | 'rejected' | 'timeout'",
  payload: "unknown",
});
export type ControlSignal = typeof ControlSignal.infer;

/**
 * The decision an approver hands back when they resolve an approval. This is
 * the payload delivered to the parked run through `sendSignalDeliver`; the
 * run's `parkOnSignal` awaitNext returns it verbatim as the correlated inbound.
 * `scope` is deliberately absent: it is a storage-and-grant concern the
 * resolver records on the approval row, not something the resumed run consumes.
 */
export const ApprovalDecision = type({
  outcome: "'approved' | 'rejected'",
  "message?": "string",
});
export type ApprovalDecision = typeof ApprovalDecision.infer;

/**
 * What a person sends back to a parked question: an answer per question id,
 * or a reply they typed instead. It becomes the `question` call's result.
 */
export const QuestionAnswer = type({
  "+": "reject",
  answers: "Record<string, string[]>",
}).or({ "+": "reject", reply: "string > 0" });
export type QuestionAnswer = typeof QuestionAnswer.infer;

/**
 * The reserved prefix that marks a signal name as an internal
 * control-plane channel rather than a free-form `awaitSignal` gate name.
 * The writer (`signalName`) and the reader (`correlationIdFromSignalName`)
 * share this one constant so the two cannot drift.
 */
const SIGNAL_NAME_PREFIX = "__signal__:";

/**
 * Construct the reserved, `__signal__:`-prefixed name under which a control
 * signal for `correlationId` is delivered. This reserves a name namespace
 * distinct from the user-authored workflow-signal names that flow through
 * `SignalDeliverFrame.signalName` in `./sidecar`: those are free-form
 * `awaitSignal` gate names chosen by workflow authors, whereas this helper
 * mints an internal name the control plane owns, so the two cannot collide.
 */
export function signalName(correlationId: string): string {
  return `${SIGNAL_NAME_PREFIX}${correlationId}`;
}

/**
 * Recover the `correlationId` from a reserved control-plane signal name
 * minted by `signalName`. Returns `undefined` for a name that does not
 * carry the reserved prefix (a free-form `awaitSignal` gate name), so a
 * caller can tell a control-plane channel apart from an author-chosen one.
 * Symmetric with `signalName`: `correlationIdFromSignalName(signalName(id))
 * === id`.
 */
export function correlationIdFromSignalName(name: string): string | undefined {
  if (!name.startsWith(SIGNAL_NAME_PREFIX)) return undefined;
  return name.slice(SIGNAL_NAME_PREFIX.length);
}
