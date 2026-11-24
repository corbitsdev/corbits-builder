import { QuestionOutcomes } from "./question-outcome.tsx";
/**
 * The project room: one conversation with the coordinator, and a reading pane beside it for what
 * the agents file, without making chat inert during document review.
 */
import { EnableAiDialog } from "../model-setup.tsx";
import { ProjectMenu } from "../project-menu.tsx";
import { ApprovalRoundsPanel } from "./approval-rounds.tsx";
import { ConceptMockup } from "./design-concepts.tsx";
import { LiveApp } from "./live-app.tsx";
import { TweakPanel } from "./mockup-tweaks.tsx";
import { SpaceScreen } from "./plugin-screens.tsx";
import {
  useRoom,
  useRoomGate,
  type ReadyRoomProps,
  type StageWorkspaceProps,
} from "./room.model.ts";
import { ROOM_NARROW_QUERY, useSidebar } from "../../sidebar-setting.ts";
import { composerKey, useUnsent } from "../../unsent.ts";
import { RoomFault, RoomSkeleton } from "./room-skeleton.tsx";
import { RoomView } from "./room.view.tsx";
import { RoomThread } from "./transcript.tsx";
import { WrittenDocument } from "./written-document.tsx";

/** The room shows its loading or fault state until its first read is in hand. */
export function StageWorkspace(props: StageWorkspaceProps) {
  const gate = useRoomGate(props);
  const sidebar = useSidebar(ROOM_NARROW_QUERY);
  const [draft, setDraft] = useUnsent(composerKey(props.projectId));
  if (gate.state === "loading")
    return (
      <RoomSkeleton
        title={props.projectTitle}
        opening={props.openingMessage}
        draft={{ value: draft, onValueChange: setDraft }}
        sidebar={{
          open: sidebar.open,
          drawer: sidebar.drawer,
          onToggleSidebar: sidebar.toggle,
          onHome: props.onNewProject,
          onSettings: () => props.onOpenSettings(),
        }}
      />
    );
  if (gate.state === "failed") return <RoomFault onRetry={gate.onRetry} />;
  return <ReadyRoom {...props} {...gate.room} />;
}

function ReadyRoom(props: ReadyRoomProps) {
  const { projectId } = props;
  const {
    view,
    projectMenu,
    enableAi,
    liveApp,
    spaceScreen,
    questionOutcomes,
  } = useRoom(props);
  return (
    <QuestionOutcomes value={questionOutcomes}>
      <RoomView
        {...view}
        // Over the project view the chat pulls up around the prompt box, so the person reads and
        // replies without leaving the page; with nothing said yet there is nothing to pull up.
        chat={
          view.conversation.empty === null ? (
            <RoomThread {...view.conversation.thread} />
          ) : undefined
        }
        pluginSpace={
          spaceScreen === null ? null : <SpaceScreen {...spaceScreen} />
        }
        projectMenu={
          projectMenu === null
            ? undefined
            : (trigger) => (
                <ProjectMenu {...projectMenu} trigger={trigger} align="start" />
              )
        }
        paneParts={{
          liveApp: liveApp === null ? null : <LiveApp {...liveApp} />,
          conceptMockup: (concept, frame) => (
            <ConceptMockup projectId={projectId} concept={concept} {...frame} />
          ),
          approvalRounds: (rounds) => (
            <ApprovalRoundsPanel projectId={projectId} flush {...rounds} />
          ),
          tweakPanel: (panel) => (
            <TweakPanel {...panel} design={{ projectId }} />
          ),
          writtenDocument: (page) => <WrittenDocument {...page} />,
        }}
      />
      <EnableAiDialog {...enableAi} />
    </QuestionOutcomes>
  );
}
