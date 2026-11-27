/**
 * What the room hands the plugins' screens: the design under review and the concepts to choose
 * from, the project's documents and values, the last answer given on the same screen, and a way
 * to run a plugin's action. It also places each plugin's screens in tabs of their own, reads the
 * room again when a screen's clock says, and remembers a document opened from the screen waiting
 * in the box.
 */
import { useEffect, useMemo, useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { ProjectArtifact } from "@corbits-builder/client";
import {
  showsScreen,
  type ConversationQuestion,
  type ScreenQuestion,
} from "@corbits-builder/schemas/conversation";
import { wording } from "../../config.ts";
import { readProjectValues, runPluginAction } from "../../api/artifacts.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import { humanFault } from "../../human-fault.ts";
import { keys } from "../../queries/keys.ts";
import type { DeliverableState } from "./deliverable-block.tsx";
import { parseBundle } from "./design-bundle.ts";
import {
  DESIGN_OPTION,
  reviewApproval,
  type ReviewedDesign,
} from "./design-concept.ts";
import { designConcepts } from "./design-concepts.model.ts";
import type { Dispatch } from "./dispatch.ts";
import type { RoomSnapshot } from "./load-room.ts";
import type {
  ChoosableConcept,
  HostSupplies,
  ListedHostProps,
  ShownDocument,
} from "./screen-question.tsx";
import { pluginTabs, screensFor, selectionNames } from "./screens.ts";

export function useScreenSupplies({
  projectId,
  archived,
  runTenantId,
  snapshot,
  artifacts,
  documentState,
  dispatches,
  screenQuestion,
  questions,
  shownDocuments,
  openDocument,
  drafted,
  reload,
}: {
  projectId: string;
  archived: boolean;
  runTenantId: string | undefined;
  snapshot: RoomSnapshot;
  /** The project's filed documents and files. */
  artifacts: readonly ProjectArtifact[];
  documentState: (item: ProjectArtifact) => DeliverableState | undefined;
  /** The hand-offs in the conversation, which name the concepts a designer works on. */
  dispatches: readonly Dispatch[];
  /** The coordinator's open question, when it shows a screen. */
  screenQuestion: ScreenQuestion | undefined;
  questions: readonly ConversationQuestion[];
  shownDocuments: readonly ShownDocument[];
  openDocument: (id: string) => void;
  /** The person has words in the box. */
  drafted: boolean;
  reload: () => void;
}) {
  const inFlight = snapshot.inFlight;
  const selectionKeys = selectionNames();
  const workspaceRead = useQuery({
    queryKey: keys.workspaceTenant,
    queryFn: workspaceTenantId,
  });
  const selection = useQuery({
    queryKey: keys.projectValues.selection(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn:
      selectionKeys.length === 0
        ? skipToken
        : ({ signal }) => readProjectValues(projectId, selectionKeys, signal),
  });
  const screenOf = useMemo(
    () => screensFor(selection.data ?? {}),
    [selection.data],
  );
  // Kept stable, so an open screen reads the project's values once rather than on every render.
  const projectValues = useMemo(
    () => ({
      read: (keys: readonly string[], signal: AbortSignal) =>
        readProjectValues(projectId, keys, signal),
    }),
    [projectId],
  );
  // A document opened from the screen waiting in the box, so the plan can say it waits on the
  // person while that screen stays unanswered.
  const [openedFromScreen, setOpenedFromScreen] = useState<{
    signal: string;
    id: string;
  } | null>(null);
  const waitsOn =
    openedFromScreen !== null &&
    screenQuestion?.signalName === openedFromScreen.signal
      ? openedFromScreen.id
      : null;
  // Each concept's option is its own tab beside the others, never an ordinary document.
  const options = artifacts.filter((item) => item.kind === DESIGN_OPTION);
  const design = artifacts.find((item) => item.kind === "design");
  // The design a review screen shows: the newest design option, else the filed design.
  const reviewed = options.at(-1) ?? design;
  const reviewedState =
    reviewed === undefined ? undefined : documentState(reviewed);
  const reviewedContent =
    reviewedState?.status === "ready"
      ? reviewedState.document.content
      : undefined;
  const reviewedFiles = useMemo(
    () => (reviewedContent === undefined ? null : parseBundle(reviewedContent)),
    [reviewedContent],
  );
  const reviewedDesign = (): ReviewedDesign | null => {
    if (reviewed === undefined || reviewedFiles === null) return null;
    return {
      files: reviewedFiles,
      version: reviewed.version,
      approval: reviewApproval(reviewed),
    };
  };
  // Concepts stay to compare until the chosen one is filed as the design, or a new round starts.
  const concepts =
    design !== undefined && !inFlight.some((run) => run.concept !== undefined)
      ? []
      : designConcepts(
          options,
          dispatches.flatMap(({ concept, direction }) =>
            concept === undefined || direction === undefined
              ? []
              : [{ label: concept, direction }],
          ),
          (option) => {
            const state = documentState(option);
            return state?.status === "ready"
              ? state.document.content
              : undefined;
          },
          design !== undefined && design.approvedVersion === design.version
            ? design.title
            : undefined,
        );
  // Filed concepts wait on the person's choice on the designer's choose screen.
  const choosable = concepts.some((concept) => concept.chosen) ? [] : concepts;
  // Each filed concept's bundle, parsed once per version it is filed at rather than on every
  // render of the room; the key names exactly the contents parsed.
  const choosableKey = choosable
    .map(({ option }) => `${option.artifactId}@${String(option.version)}`)
    .join("\n");
  const choosableFiles = useMemo(
    () => choosable.map((concept) => parseBundle(concept.content)),
    [choosableKey],
  );
  const choosableConcepts = (): ChoosableConcept[] =>
    choosable.flatMap((concept, index) => {
      const files = choosableFiles[index];
      const filed = options.find(
        (option) => option.artifactId === concept.option.artifactId,
      );
      if (files === undefined || files === null || filed === undefined)
        return [];
      return [
        {
          label: concept.label,
          direction: concept.direction,
          files,
          version: filed.version,
          approval: reviewApproval(filed),
        },
      ];
    });
  const supplies: HostSupplies = {
    design: reviewedDesign(),
    designConcepts: choosableConcepts(),
    // The last round's answer on the same screen, so the person sees what they asked for before.
    earlierAnswer:
      screenQuestion === undefined
        ? undefined
        : questions
            .flatMap((question) =>
              question.signalName !== screenQuestion.signalName &&
              showsScreen(question) &&
              question.asked.plugin === screenQuestion.asked.plugin &&
              question.asked.action === screenQuestion.asked.action &&
              question.status === "answered" &&
              "output" in question.answer
                ? [question.answer.output]
                : [],
            )
            .at(-1),
    documents: {
      list: shownDocuments,
      open: (id) => {
        if (screenQuestion !== undefined)
          setOpenedFromScreen({ signal: screenQuestion.signalName, id });
        openDocument(id);
      },
    },
    reply: { drafted },
    tenants:
      runTenantId === undefined || workspaceRead.data === undefined
        ? null
        : { project: runTenantId, workspace: workspaceRead.data },
    asked: (signalName) =>
      snapshot.plan.asked.find((each) => each.signalName === signalName)?.data,
  };
  const actFromScreen: ListedHostProps["act"] = async (
    plugin,
    action,
    input,
  ) => {
    try {
      await runPluginAction(projectId, plugin, action, input);
    } catch (cause) {
      return humanFault(cause, wording.questions.answerFault.refused);
    }
    reload();
    return undefined;
  };
  const pluginScreens = pluginTabs({
    screens: archived ? [] : snapshot.plan.screens,
    screenOf,
    supplies,
    act: actFromScreen,
  });
  // Each read times its own wake, so a screen counting down is read again as its clock says.
  const { rereadIn } = pluginScreens;
  useEffect(() => {
    if (rereadIn === undefined) return;
    const timer = setTimeout(() => reload(), rereadIn);
    return () => clearTimeout(timer);
  }, [snapshot, rereadIn, reload]);

  return {
    screenOf,
    projectValues,
    supplies,
    act: actFromScreen,
    /** Each plugin's screens with a tab of their own. */
    pluginScreens,
    concepts,
    /** The document opened from the screen waiting in the box, while it still waits; else null. */
    waitsOn,
  };
}
