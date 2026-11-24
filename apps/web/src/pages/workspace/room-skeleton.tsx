/**
 * The project room while its first read is on its way, drawn as the room it will be: the sidebar
 * with the project's name and its plan still to come, the conversation in its column, and the
 * prompt box where it will stand, saying the project is opening. Each stands where the loaded
 * room puts it, so nothing moves when the room arrives; only the faint shapes give way to what
 * they stood for. The shapes are not announced; the box's line is.
 */
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@corbits/react-ui";
import { Composer } from "../../composer.tsx";
import { Fault } from "../../components.jsx";
import { wording } from "../../config.ts";
import { SidebarFrame } from "./project-sidebar.view.tsx";
import styles from "./room-skeleton.module.css";
import { StageView } from "./stage-view.tsx";

// The plan's rows, as long as step names tend to run, so the list reads as a list.
const PLAN_ROWS = ["72%", "58%", "80%", "50%", "66%"];

const nothing = () => {};

export function RoomSkeleton({
  title,
  sidebar,
}: {
  /** The project's name, as the project list has it. */
  title: string;
  /** The sidebar as the person left it, so it is already where the room will put it. */
  sidebar: { open: boolean; drawer: boolean; onToggleSidebar: () => void };
}) {
  const opening = wording.message.projectLoading(title);
  return (
    <StageView aria-busy="true">
      <div
        className={styles.room}
        data-beside={sidebar.open && !sidebar.drawer ? "" : undefined}
      >
        <SidebarFrame
          title={title}
          open={sidebar.open}
          drawer={sidebar.drawer}
          onToggleSidebar={sidebar.onToggleSidebar}
        >
          <ul className={styles.plan} aria-hidden="true">
            {PLAN_ROWS.map((width, index) => (
              <li key={index} className={styles.step}>
                <span className={styles.dot} />
                <span className={styles.bar} style={{ width }} />
              </li>
            ))}
          </ul>
        </SidebarFrame>
        <div className={styles.main}>
          <div className={styles.thread} aria-hidden="true">
            <div className={styles.mine} style={{ width: "36%" }} />
            <div className={styles.reply}>
              <span className={styles.name} />
              <span className={styles.line} />
              <span className={styles.line} style={{ width: "92%" }} />
              <span className={styles.line} style={{ width: "64%" }} />
            </div>
            <div className={styles.mine} style={{ width: "24%" }} />
            <div className={styles.reply}>
              <span className={styles.name} />
              <span className={styles.line} style={{ width: "84%" }} />
              <span className={styles.line} style={{ width: "48%" }} />
            </div>
          </div>
          <div className={styles.foot}>
            <p className={styles.said} role="status">
              {opening}
            </p>
            {/* The box itself, held until the room can take what is typed in it. */}
            <Composer>
              <PromptInput
                value=""
                onValueChange={nothing}
                onSubmit={nothing}
                disabled
                aria-hidden="true"
              >
                <PromptInputTextarea placeholder={opening} />
                <PromptInputToolbar>
                  <PromptInputSubmit className="ms-auto" />
                </PromptInputToolbar>
              </PromptInput>
            </Composer>
          </div>
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
