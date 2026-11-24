/**
 * The project room while its first read is on its way, drawn as the room it will be: the sidebar
 * with the project's name and its plan still to come, the conversation in its column, and the
 * prompt box where it will stand, saying the project is opening. Each stands where the loaded
 * room puts it, so nothing moves when the room arrives; only the faint shapes give way to what
 * they stood for. The shapes are not announced; the box's line is. A project just started has
 * the person's own first words in place of the shapes, with the coordinator thinking under them,
 * and the sidebar the room will have: its plan still empty and its links already working.
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
import { useEffect, useRef } from "react";
import { Composer } from "../../composer.tsx";
import { Fault } from "../../components.jsx";
import { wording } from "../../config.ts";
import {
  ProjectSidebarView,
  SidebarFrame,
  type ProjectSidebarViewProps,
} from "./project-sidebar.view.tsx";
import { RoomFrame } from "./room-frame.tsx";
import styles from "./room-skeleton.module.css";
import { StageView } from "./stage-view.tsx";

// The plan's rows, as long as step names tend to run, so the list reads as a list.
const PLAN_ROWS = ["72%", "58%", "80%", "50%", "66%"];

const nothing = () => {};

/** Where the sidebar's links lead while a project just started is being made. */
export type StartingWays = Pick<
  ProjectSidebarViewProps,
  "onNewProject" | "onWorkspaceSettings" | "onAccount"
>;

export function RoomSkeleton({
  title,
  sidebar,
  opening,
  status,
  draft,
  ways,
}: {
  /** The project's name, as the project list has it. */
  title: string;
  /** The sidebar as the person left it, so it is already where the room will put it. */
  sidebar: { open: boolean; drawer: boolean; onToggleSidebar: () => void };
  /** The person's first words to a project just started, shown as theirs while it opens. */
  opening?: string | undefined;
  /** What the box says is happening; by default, that the project is opening. */
  status?: string | undefined;
  /** What is typed into the box, kept for the room; without it the box takes nothing. */
  draft?: { value: string; onValueChange: (value: string) => void } | undefined;
  /**
   * For a project just started, whose plan is known to be empty: the sidebar is the room's own,
   * and its links lead where they will. Absent, the plan is drawn as faint rows.
   */
  ways?: StartingWays | undefined;
}) {
  const said = status ?? wording.message.projectLoading(title);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // A project just started was being typed about a moment ago, so the cursor stays in the box.
  const takesCursor = draft !== undefined && opening !== undefined;
  useEffect(() => {
    const box = boxRef.current;
    if (!takesCursor || box === null) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [takesCursor]);
  return (
    <StageView aria-busy="true">
      <div className={styles.room} data-slot="room-skeleton">
        <RoomFrame
          sidebar={
            ways === undefined ? (
              <SidebarFrame
                title={title}
                open={sidebar.open}
                drawer={sidebar.drawer}
                onToggleSidebar={sidebar.onToggleSidebar}
                plan={
                  <ul className={styles.plan} aria-hidden="true">
                    {PLAN_ROWS.map((width, index) => (
                      <li key={index} className={styles.step}>
                        <span className={styles.dot} />
                        <span className={styles.bar} style={{ width }} />
                      </li>
                    ))}
                  </ul>
                }
              />
            ) : (
              <ProjectSidebarView
                project={title}
                {...sidebar}
                plan={[]}
                app="not_built"
                appOpen={false}
                shown={null}
                onOpenApp={nothing}
                onOpenStep={nothing}
                {...ways}
              />
            )
          }
          side={{ state: "empty" }}
        >
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
              {/* What is typed waits in the box until the room is there to send it. */}
              <Composer>
                <PromptInput
                  value={draft?.value ?? ""}
                  onValueChange={draft?.onValueChange ?? nothing}
                  onSubmit={nothing}
                  canSubmit={false}
                  disabled={draft === undefined}
                  aria-hidden={draft === undefined ? "true" : undefined}
                >
                  {/* The room's own box, so nothing in it changes when the room arrives. What is
                    opening is read out by the line above, not written into the box: a project's
                    name can be the person's whole first message. */}
                  <PromptInputTextarea
                    ref={boxRef}
                    placeholder={wording.composer.reply}
                  />
                  <PromptInputToolbar>
                    <PromptInputSubmit className="ms-auto" />
                  </PromptInputToolbar>
                </PromptInput>
              </Composer>
            </div>
          </div>
        </RoomFrame>
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
