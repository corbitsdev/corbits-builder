/**
 * The bar's approval of the document being read: the version on show once approved, else Approve
 * while it is the newest. An older version read from the menu is neither, since only the newest
 * can be approved.
 */
import { useState } from "react";
import { wording } from "../../../config.ts";
import type { PaneBarGroup } from "../pane-bar.tsx";

/**
 * The person's approval of the document they read, with no question asking for it: the version
 * approved and when, if any, and how to approve the version on show.
 */
export type DocumentApprovalControl = {
  approvedVersion: number | undefined;
  approvedAt: string | undefined;
  approve: (version: number) => Promise<void>;
};

export function useApproveGroup(
  approval: DocumentApprovalControl | undefined,
  viewing: number,
  newest: number,
): PaneBarGroup {
  const [approving, setApproving] = useState(false);
  if (approval === undefined) return [];
  const words = wording.documentApproval;
  if (approval.approvedVersion === viewing)
    return [
      {
        id: "approved",
        label: words.approvedLabel(viewing, approval.approvedAt),
        text: words.approved(viewing),
        note: true,
      },
    ];
  if (viewing !== newest) return [];
  const approve = async () => {
    setApproving(true);
    try {
      await approval.approve(viewing);
    } finally {
      setApproving(false);
    }
  };
  return [
    {
      id: "approve",
      label: words.approveLabel(viewing),
      text: words.approve(viewing),
      disabled: approving,
      onSelect: () => void approve(),
    },
  ];
}
