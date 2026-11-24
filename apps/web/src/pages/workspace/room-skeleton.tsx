/**
 * The project room while its first read is on its way, drawn as the room it will be: the sidebar
 * with the project's name and its plan still to come, the conversation in its column, and the
 * prompt box where it will stand, saying the project is opening. Each stands where the loaded
 * room puts it, so nothing moves when the room arrives; only the faint shapes give way to what
 * they stood for. The shapes are not announced; the box's line is. A project just started has
 * the person's own first words in place of the shapes, with the coordinator thinking under them.
 */
import {
  Message,
  MessageContent,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  ShimmerText,
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
  opening,
  status,
}: {
  /** The project's name, as the project list has it. */
  title: string;
  /** The sidebar as the person left it, so it is already where the room will put it. */
  sidebar: { open: boolean; drawer: boolean; onToggleSidebar: () => void };
  /** The person's first words to a project just started, shown as theirs while it opens. */
  opening?: string | undefined;
  /** What the box says is happening; by default, that the project is opening. */
  status?: string | undefined;
}) {
  const said = status ?? wording.message.projectLoading(title);
  return (
    <StageView aria-busy="true">
      <div
        className={styles.room}
        data-slot="room-skeleton"
        data-beside={sidebar.drawer ? undefined : ""}
        data-open={sidebar.open ? "" : undefined}
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
          {opening === undefined ? (
            <Shapes />
          ) : (
            <div className={styles.thread} data-opening="">
              <Message
                from="own"
                status="sent"
                aria-label={wording.speaker.you}
              >
                <MessageContent text={opening} />
              </Message>
              <Message
                from="agent"
                status="streaming"
                aria-label={wording.speaker.coordinator}
              >
                <ShimmerText>{wording.activity.thinkingNow}</ShimmerText>
              </Message>
            </div>
          )}
          <div className={styles.foot}>
            <p className={styles.said} role="status">
              {said}
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
                {/* The room's own empty box, so nothing in it changes when the room arrives. What is
                    opening is read out by the line above, not written into the box: a project's
                    name can be the person's whole first message. */}
                <PromptInputTextarea placeholder={wording.composer.reply} />
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

/** The turns on their way, as faint shapes: a message, a reply, a message, a reply. */
function Shapes() {
  return (
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
