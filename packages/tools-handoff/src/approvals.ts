export const APPROVABLE = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
] as const;
// The documents in the order each builds on the ones before it; the build plan follows the design.
export const DOCUMENT_ORDER = [
  ...APPROVABLE.slice(0, 4),
  "design",
  "build_plan",
] as const;

/** The filed documents waiting on the person's request_approval at their current version. */
export function awaitingApproval<
  T extends { kind: string; version: number; approvedVersion?: number },
>(filed: readonly T[], agentDecidesApprovals: boolean): T[] {
  if (agentDecidesApprovals) return [];
  return filed.filter(
    (item) =>
      (APPROVABLE as readonly string[]).includes(item.kind) &&
      item.approvedVersion !== item.version,
  );
}
