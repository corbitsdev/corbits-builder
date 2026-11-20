import {
  QuestionOutcomes,
  QuestionEntry,
  type AnswerOutcome,
} from "./question-outcome.tsx";
import { wording } from "../../config.ts";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
/**
 * A plugin's screen as the conversation hosts it, in each state a person can meet it, for the
 * screens' stories: the real host around the real view, with the project's values, the host's
 * supplies and the hub's answer stood in by plain values.
 */
import { useLayoutEffect, useState, type ComponentType } from "react";
import { type Type } from "arktype";
import {
  ScreenActionBuilder,
  type ProjectRead,
  type ProjectValues,
  type Screen,
} from "@corbits-builder/plugin";
import type { ReadyPlanOffer } from "@corbits-builder/schemas/project";
import type { QuestionAnswer } from "@corbits-builder/schemas/conversation";
import { MockupFrame } from "./mockup-frame.tsx";
import { ClosedQuestions } from "./questions-card.tsx";
import { sampleDesign } from "./sample-design.ts";
import {
  PageScreenCard,
  ScreenQuestion,
  screenHost,
  type HostSupplies,
  type ViewResources,
} from "./screen-question.tsx";

/** Where the story's question stands. */
export type ScreenState =
  | "open"
  | "chosen"
  | "sending"
  | "refused"
  | "answered"
  | "replied"
  | "closed"
  | "missing";

export const storySupplies: HostSupplies = {
  design: {
    files: sampleDesign,
    version: 2,
    approval: { option: "design-option-2" },
  },
  mockupFrame: MockupFrame,
  earlierAnswer: undefined,
  documents: {
    list: [
      {
        kind: "build_plan",
        title: "Build plan",
        artifactId: "artifact-plan",
        version: 2,
        summary:
          "A web app for a small bakery to take Saturday orders, built in two weeks.",
      },
    ],
    open: () => undefined,
  },
  designConcepts: [
    {
      label: "Warm",
      direction: "Soft cream ground, rounded cards, a friendly serif.",
      files: sampleDesign,
      version: 1,
      approval: { option: "design-option-1" },
    },
    {
      label: "Crisp",
      direction: "White ground, sharp edges, a tight sans serif.",
      files: sampleDesign,
      version: 1,
      approval: { option: "design-option-2" },
    },
  ],
  reply: { drafted: false, stage: () => undefined },
  tenants: { project: "tenant-project", workspace: "tenant-workspace" },
  asked: () => undefined,
};

/** One plugin's screen action, hosted as the interface hosts it. */
export function storyScreen<In, Out, Data, Prepared>(
  handle: string,
  declared: unknown,
  plugin: {
    screen: Screen<In, Out, Data, Prepared>;
    view: ComponentType<
      ScreenViewProps<
        Type<In>["infer"],
        Type<Out>["infer"],
        Prepared,
        ViewResources
      >
    >;
    data: Type<Data>["infer"];
  },
) {
  return {
    host: screenHost(handle, ScreenActionBuilder.assert(declared), plugin),
    label: (input: unknown) =>
      plugin.screen.describe.says?.label(plugin.screen.input.assert(input)) ??
      handle,
    // What the hub would prepare for a question with this input, for a screen that prepares so.
    asked: (input: unknown, project: ProjectRead) =>
      plugin.screen.fromProject?.(plugin.screen.input.assert(input), project),
  };
}

// The project as the hub reads it for a screen, from the story's values and ready-made plans.
const storyRead = (
  values: ProjectValues,
  plans: (group: string) => readonly ReadyPlanOffer[],
): ProjectRead => ({
  value: (name) => values[name] ?? null,
  facts: new Set(),
  plan: [],
  planned: [],
  now: Date.now(),
  app: { version: undefined },
  coordinator: { working: false, since: undefined },
  runs: [],
  asking: [],
  plans,
});

export function ScreenStory({
  screen,
  state,
  input,
  project,
  draft,
  output,
  placed = "conversation",
  plans = () => [],
}: {
  screen: ReturnType<typeof storyScreen>;
  state: ScreenState;
  input: Record<string, unknown>;
  project: ProjectValues;
  /** What the person has chosen, kept in the states after they chose. */
  draft?: Record<string, unknown>;
  /** What they chose, in the "answered" state. */
  output?: Record<string, unknown>;
  /** A screen placed on the page shows a card in the conversation that opens it. */
  placed?: "conversation" | "page";
  /** The installed ready-made plans a screen that prepares from the project reads. */
  plans?: (group: string) => readonly ReadyPlanOffer[];
}) {
  const signalName = `story-${state}-${placed}`;
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const key = `unsent:screen:${signalName}`;
    const kept =
      state === "chosen" || state === "sending" || state === "refused";
    if (draft === undefined || !kept) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(draft));
    setReady(true);
  }, [signalName, draft, state]);
  const [onPage, setOnPage] = useState(placed === "page");
  // An answer the hub took settles the question, as the room does.
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, AnswerOutcome>>(
    new Map(),
  );
  const [given, setGiven] = useState<QuestionAnswer>();
  if (!ready) return null;
  if (state === "closed")
    return <ClosedQuestions asks={[screen.label(input)]} />;
  const answers: Partial<Record<ScreenState, QuestionAnswer>> = {
    answered: { output: output ?? {} },
    replied: { reply: "Make the headings bolder instead." },
  };
  const question = (
    <ScreenQuestion
      signalName={signalName}
      host={state === "missing" ? undefined : screen.host}
      input={input}
      projectValues={{ read: () => Promise.resolve(project) }}
      answer={given ?? answers[state]}
      disabled={state === "sending"}
      // Refused stories fail every send, so the fault shows once something is sent.
      onAnswer={(answer) => {
        if (state === "refused") {
          setOutcomes(
            new Map([
              [
                signalName,
                {
                  kind: "refused",
                  fault: wording.questions.answerFault.refused,
                },
              ],
            ]),
          );
          return Promise.resolve(false);
        }
        setOutcomes(new Map([[signalName, { kind: "accepted", answer }]]));
        setGiven(answer);
        return Promise.resolve(true);
      }}
      supplies={{
        ...storySupplies,
        asked: () => screen.asked(input, storyRead(project, plans)),
      }}
      page={onPage ? { close: () => setOnPage(false) } : undefined}
    />
  );
  const pagePending =
    placed === "page" && given === undefined && answers[state] === undefined;
  return (
    <QuestionOutcomes value={outcomes}>
      <QuestionEntry signalName={signalName}>
        {pagePending ? (
          <PageScreenCard onOpen={() => setOnPage(true)} />
        ) : (
          question
        )}
      </QuestionEntry>
      {pagePending ? (
        <div hidden={!onPage} data-slot="story-page">
          {question}
        </div>
      ) : null}
    </QuestionOutcomes>
  );
}
