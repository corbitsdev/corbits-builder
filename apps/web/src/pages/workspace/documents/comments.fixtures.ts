/** Comment drafts on a bakery project's documents, as the tests and stories start from. */
import type { CommentDraft } from "./comments.ts";

export const briefPhone: CommentDraft = {
  id: "draft-phone",
  document: "problem_brief",
  title: "Problem brief",
  version: 2,
  quote: "Orders are taken by phone and written on paper.",
  occurrence: 0,
  comment: "Mention text and walk-in orders too.",
};

export const briefSaturday: CommentDraft = {
  id: "draft-saturday",
  document: "problem_brief",
  title: "Problem brief",
  version: 2,
  quote: "Saturdays are the busiest day.",
  occurrence: 0,
  comment: "Say how many orders a Saturday brings.",
};

export const planDeadline: CommentDraft = {
  id: "draft-deadline",
  document: "build_plan",
  title: "Build plan",
  version: 1,
  quote: "Two weeks to the first release.",
  occurrence: 0,
  comment: "Can the order list ship first?",
};

/** A draft on a passage that a later version of the brief rewrote. */
export const briefRewritten: CommentDraft = {
  id: "draft-rewritten",
  document: "problem_brief",
  title: "Problem brief",
  version: 1,
  quote: "Small bakeries take cake orders by phone and lose some of them.",
  occurrence: 0,
  comment: "Is losing orders the real problem, or forgetting them?",
};

/** Three drafts across two documents. */
export const projectDrafts: readonly CommentDraft[] = [
  briefPhone,
  planDeadline,
  briefSaturday,
];
