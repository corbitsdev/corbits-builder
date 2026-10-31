/**
 * One placeholder for the whole project room.
 *
 * Chat and artifacts share this until both have something that was actually
 * loaded. A skeleton box is not announced; the status line is.
 */
import { wording } from "../../config.ts";
import { Skeleton } from "@corbits/react-ui";
import { PANES_CLASS } from "./pane-classes.ts";

export function RoomSkeleton() {
  return (
    <div className="stage-view workspace-room-skeleton" aria-busy="true">
      <p className="workspace-status" role="status">
        Loading this project…
      </p>
      <div className={`${PANES_CLASS} workspace-split`}>
        <Skeleton className="workspace-skeleton-pane" />
        <Skeleton className="workspace-skeleton-pane" />
      </div>
    </div>
  );
}

export function RoomFault({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="stage-view workspace-room-fault" role="alert">
      <div className="workspace-fault">
        <p>{wording.message.projectNotOpened}</p>
        <button type="button" className="btn" onClick={onRetry}>
          {wording.action.retry}
        </button>
      </div>
    </div>
  );
}
