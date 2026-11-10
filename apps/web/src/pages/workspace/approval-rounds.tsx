/**
 * The approval rounds a package goes through: who was asked to sign off, and what each decided
 * and asked for. `approval-rounds.model.ts` holds what they do and `approval-rounds.view.tsx`
 * how they look; the form that adds a reviewer is `share-package.tsx`.
 */
import {
  useApprovalRounds,
  type ApprovalRoundsProps,
} from "./approval-rounds.model.ts";
import { ApprovalRoundsView } from "./approval-rounds.view.tsx";
import { SharePackageDialog } from "./share-package.tsx";

export function ApprovalRoundsPanel(props: ApprovalRoundsProps) {
  const { view, addReviewer } = useApprovalRounds(props);
  return (
    <ApprovalRoundsView
      {...view}
      addReviewerForm={<SharePackageDialog {...addReviewer} />}
    />
  );
}
