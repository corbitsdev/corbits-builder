/**
 * One placeholder for the whole project room.
 *
 * Chat and artifacts share this until both have something that was actually
 * loaded. A skeleton box is not announced; the status line is.
 */
import { Fault } from "../../components.jsx";
import { wording } from "../../config.ts";
import { Skeleton } from "@corbits/react-ui";
import styles from "./room-skeleton.module.css";
import { StageView } from "./stage-view.tsx";

export function RoomSkeleton() {
  return (
    <StageView aria-busy="true">
      <div className={styles.skeleton}>
        <p className={styles.status} role="status">
          {wording.message.projectLoading}
        </p>
        <div className={styles.panes}>
          <Skeleton className={styles.pane} />
          <Skeleton className={styles.pane} />
        </div>
      </div>
    </StageView>
  );
}

export function RoomFault({ onRetry }: { onRetry: () => void }) {
  return (
    <StageView>
      <div className={styles.fault}>
        <Fault onRetry={onRetry}>{wording.message.projectNotOpened}</Fault>
      </div>
    </StageView>
  );
}
