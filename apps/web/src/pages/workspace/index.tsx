/**
 * The project room: one conversation with the coordinator, and a reading pane beside it for what
 * the agents file, without making chat inert during document review.
 */
import { EnableAiDialog } from "../model-setup.tsx";
import { ApprovalRoundsPanel } from "./approval-rounds.tsx";
import { ConceptMockup } from "./design-concepts.tsx";
import { DesignThemes } from "./design-themes.tsx";
import { LiveApp } from "./live-app.tsx";
import { TweakPanel } from "./mockup-tweaks.tsx";
import { NextStepLine } from "./next-step.tsx";
import { ProjectValues } from "./project-values.tsx";
import {
  useRoom,
  useRoomGate,
  type ReadyRoomProps,
  type StageWorkspaceProps,
} from "./room.model.ts";
import { RoomFault, RoomSkeleton } from "./room-skeleton.tsx";
import { RoomView } from "./room.view.tsx";
import { ScreenQuestion } from "./screen-question.tsx";

/** The room shows its loading or fault state until its first read is in hand. */
export function StageWorkspace(props: StageWorkspaceProps) {
  const gate = useRoomGate(props);
  if (gate.state === "loading") return <RoomSkeleton />;
  if (gate.state === "failed") return <RoomFault onRetry={gate.onRetry} />;
  return <ReadyRoom {...props} {...gate.room} />;
}

function ReadyRoom(props: ReadyRoomProps) {
  const { projectId } = props;
  const { view, nextStep, enableAi, liveApp, themes, values, pageScreen } =
    useRoom(props);
  return (
    <>
      <RoomView
        {...view}
        nextStep={nextStep === null ? null : <NextStepLine {...nextStep} />}
        page={pageScreen === null ? null : <ScreenQuestion {...pageScreen} />}
        paneParts={{
          liveApp: liveApp === null ? null : <LiveApp {...liveApp} />,
          themes: themes === null ? null : <DesignThemes {...themes} />,
          values: values === null ? null : <ProjectValues {...values} />,
          conceptMockup: (concept, frame) => (
            <ConceptMockup projectId={projectId} concept={concept} {...frame} />
          ),
          approvalRounds: (rounds) => (
            <ApprovalRoundsPanel projectId={projectId} flush {...rounds} />
          ),
          tweakPanel: (panel) => (
            <TweakPanel {...panel} design={{ projectId }} />
          ),
        }}
      />
      <EnableAiDialog {...enableAi} />
    </>
  );
}
