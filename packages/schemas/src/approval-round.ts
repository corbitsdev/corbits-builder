import { type } from "arktype";

const sha256 = /^[a-f0-9]{64}$/;

export const ExpiryPreset = type("'24h' | '7d' | '30d'");
export type ExpiryPreset = typeof ExpiryPreset.infer;

export const ReviewerOutcome = type(
  "'approve' | 'request_changes' | 'comment'",
);
export type ReviewerOutcome = typeof ReviewerOutcome.infer;

export const ReviewerState = type("'sent' | 'decided' | 'expired'");
export type ReviewerState = typeof ReviewerState.infer;

export const SlideNote = type({
  "+": "reject",
  slide: "number.integer >= 1",
  text: "string > 0",
});
export type SlideNote = typeof SlideNote.infer;

export const ReviewerInput = type({
  "+": "reject",
  name: "string > 0",
  persona: "string > 0",
  "email?": "string > 0",
});
export type ReviewerInput = typeof ReviewerInput.infer;

export const StartApprovalRound = type({
  "+": "reject",
  packageVersion: "number.integer > 0",
  expiry: ExpiryPreset,
  reviewers: ReviewerInput.array().atLeastLength(1).atMostLength(20),
});
export type StartApprovalRound = typeof StartApprovalRound.infer;

export const RecordReviewerDecision = type({
  "+": "reject",
  outcome: ReviewerOutcome,
  "note?": "string",
  "slideNotes?": SlideNote.array(),
});
export type RecordReviewerDecision = typeof RecordReviewerDecision.infer;

export const ReviewerDecision = type({
  "+": "reject",
  outcome: ReviewerOutcome,
  "note?": "string",
  slideNotes: SlideNote.array(),
  decidedAt: "string > 0",
});
export type ReviewerDecision = typeof ReviewerDecision.infer;

export const ApprovalReviewer = type({
  "+": "reject",
  id: "string > 0",
  name: "string > 0",
  persona: "string > 0",
  "email?": "string > 0",
  state: ReviewerState,
  "decision?": ReviewerDecision,
});
export type ApprovalReviewer = typeof ApprovalReviewer.infer;

export const ApprovalRoundStatus = type("'open' | 'expired' | 'settled'");
export type ApprovalRoundStatus = typeof ApprovalRoundStatus.infer;

export const ApprovalRound = type({
  "+": "reject",
  roundId: "string > 0",
  projectId: "string > 0",
  artifactId: "string > 0",
  packageVersion: "number.integer > 0",
  packageSha256: sha256,
  expiry: ExpiryPreset,
  status: ApprovalRoundStatus,
  createdAt: "string > 0",
  expiresAt: "string > 0",
  "settledAt?": "string > 0",
  reviewers: ApprovalReviewer.array(),
  "triggeredRunId?": "string > 0",
});
export type ApprovalRound = typeof ApprovalRound.infer;

export const ApprovalRoundList = type({
  "+": "reject",
  rounds: ApprovalRound.array(),
});
export type ApprovalRoundList = typeof ApprovalRoundList.infer;
