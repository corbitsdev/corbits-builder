import { useWorkspaceApprovals } from "./workspace-approvals.model.ts";
import { WorkspaceApprovalsView } from "./workspace-approvals.view.tsx";

/** The reviewers saved for every project, and the dialog that adds one. */
export function WorkspaceApprovals() {
  return <WorkspaceApprovalsView {...useWorkspaceApprovals()} />;
}
