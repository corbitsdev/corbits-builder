import { useWorkspaceApprovals } from "./workspace-approvals.model.ts";
import { WorkspaceApprovalsView } from "./workspace-approvals.view.tsx";

/** Workspace-level approval toggle and saved workspace reviewers. */
export function WorkspaceApprovals() {
  return <WorkspaceApprovalsView {...useWorkspaceApprovals()} />;
}
