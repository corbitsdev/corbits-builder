/**
 * A question the coordinator asked as a plugin's screen. The plugin, not the agent, decides what is
 * drawn: its view gets the project's values it reads, the checked input and the draft. Its output
 * answers the question through the hub, which saves the values it writes and records what it approves.
 */
import { useEffect, useState, type ComponentType } from "react";
import type { Type } from "arktype";
import {
  validateInput,
  validateOutput,
  type ProjectValues,
  type Screen,
  type ScreenActionBuilder,
  type ScreenViewProps,
} from "@corbits-builder/plugin";
import { QuestionAnswer } from "@intx/types/signals";
import { Button } from "@corbits/react-ui";
import { ScreenCancel } from "@corbits-builder/plugin-ui/screen-actions";
import { wording } from "../../config.ts";
import { Fault, InlineNote } from "../../components.jsx";
import type { DesignFiles } from "./design-bundle.ts";
import type { MockupFrameProps } from "./mockup-frame.tsx";
import { SettledReply } from "./questions-card.tsx";

const text = wording.questions;

// The project's facts, which gate options such as paid fonts. None reach the interface yet.
export const projectFacts: readonly string[] = [];

/** Reads the open project's values by name. */
export type ProjectValuesStore = {
  read(keys: readonly string[], signal: AbortSignal): Promise<ProjectValues>;
};

/** The design a screen reviews, and the design option an approval of it chooses, if any. */
export type ReviewedDesign = {
  files: DesignFiles;
  version: number | "draft";
  approval: { option: string } | { unavailable: string };
};

/** A filed document at its current version, as a screen lists it to approve. */
export type ShownDocument = {
  kind: string;
  title: string;
  artifactId: string;
  version: number;
  approvedVersion?: number;
  /** The document's own `## In short` section, as markdown, when it has one. */
  summary?: string;
};

/** What the interface itself supplies a screen's view, by the names a manifest lists under host. */
export type HostSupplies = {
  /** The live draft while a designer works, else the newest filed design or design option. */
  design: ReviewedDesign | null;
  /** A design bundle drawn in the design pane's own sandboxed frame. */
  mockupFrame: ComponentType<MockupFrameProps>;
  /** The output of the latest question the coordinator asked with the same screen, if answered. */
  earlierAnswer: unknown;
  /** The project's filed documents, and a way to open one over the room by its kind. */
  documents: { list: readonly ShownDocument[]; open(kind: string): void };
  /** Puts the person in the prompt box, where what they type answers the open question in words. */
  focusReply: () => void;
  /** The filed design concepts the person has yet to choose between, in the order they were asked about. */
  designConcepts: readonly ChoosableConcept[];
};

/** A filed design concept, and the design option choosing it approves, if any. */
export type ChoosableConcept = {
  label: string;
  direction: string | undefined;
  files: DesignFiles;
  version: number;
  approval: ReviewedDesign["approval"];
};

const SUPPLIED: ReadonlySet<string> = new Set<keyof HostSupplies>([
  "design",
  "mockupFrame",
  "earlierAnswer",
  "documents",
  "focusReply",
  "designConcepts",
]);

/** How a screen placed on the page reaches the room's prompt box. */
export type PageHost = {
  /** What Send in the prompt box does in place of a reply, given the typed text. */
  stage(send: ((message: string | undefined) => Promise<boolean>) | null): void;
  sendStaged(): void;
  close(): void;
};

export type ScreenHostProps = {
  input: Record<string, unknown>;
  output: Record<string, unknown> | undefined;
  projectValues: ProjectValuesStore;
  disabled: boolean;
  onAnswer: (answer: QuestionAnswer) => Promise<boolean>;
  host: HostSupplies;
  page?: PageHost | undefined;
};

/** One plugin's screen action, by its name such as "designer pick-fonts", typed end to end, behind props every screen shares. */
export function screenHost<In, Out, Data, Prepared>(
  handle: string,
  builder: ScreenActionBuilder,
  plugin: {
    screen: Screen<In, Out, Data, Prepared>;
    view: ComponentType<
      ScreenViewProps<
        Type<In>["infer"],
        Type<Out>["infer"],
        Prepared,
        HostSupplies
      >
    >;
    data: Type<Data>["infer"];
  },
): ComponentType<ScreenHostProps> {
  const { screen, view: View, data } = plugin;
  const { reads = [], host: supplied = [] } = builder;
  const unknown = supplied.find((name) => !SUPPLIED.has(name));
  if (unknown !== undefined)
    throw new Error(
      `${handle} asks for ${unknown}, which this interface does not supply.`,
    );

  return function ScreenHost({
    input,
    output,
    projectValues,
    disabled,
    onAnswer,
    host,
    page,
  }) {
    const [project, setProject] = useState<ProjectValues>();
    const [unreadable, setUnreadable] = useState(false);
    const [draft, setDraft] = useState<Partial<Type<Out>["infer"]>>({});
    const [submitting, setSubmitting] = useState(false);
    const [fault, setFault] = useState<string>();
    const settled = output !== undefined;

    useEffect(() => {
      if (settled) return;
      const abort = new AbortController();
      const load = async () => {
        try {
          // The hub refuses a read of no names, and a screen that reads none needs no read.
          setProject(
            reads.length === 0
              ? {}
              : await projectValues.read(reads, abort.signal),
          );
        } catch (cause) {
          if (abort.signal.aborted) return;
          console.warn(`${handle} could not read the project's values.`, cause);
          setUnreadable(true);
        }
      };
      void load();
      return () => abort.abort();
    }, [projectValues, settled]);

    if (unreadable) return <InlineNote>{text.screenUnavailable}</InlineNote>;
    // Once answered, the project already holds the answer, so the settled screen draws from it alone.
    const shown: ProjectValues | undefined = settled ? {} : project;
    if (shown === undefined)
      return <InlineNote>{text.screenLoading}</InlineNote>;
    const checked = validateInput(handle, screen, input, data, shown);
    const answered =
      output === undefined ? undefined : validateOutput(handle, screen, output);
    if (!checked.ok || checked.prepared === undefined || answered?.ok === false)
      return <InlineNote>{text.screenUnavailable}</InlineNote>;

    // Whether the answer reached the hub; a fault is the screen's to show.
    const send = async (answer: QuestionAnswer) => {
      setSubmitting(true);
      setFault(undefined);
      // Once sent, the screen stays submitting until the room shows the answer and it settles.
      if (await onAnswer(answer)) return true;
      setSubmitting(false);
      setFault(text.notSent);
      return false;
    };
    const answerWith = (chosen: Type<Out>["infer"]) => {
      const result = validateOutput(handle, screen, chosen);
      if (!result.ok) throw new Error(result.text);
      return send(QuestionAnswer.assert({ output: result.output }));
    };
    const submit = async (chosen: Type<Out>["infer"]) => {
      await answerWith(chosen);
    };
    return (
      <ScreenCancel
        value={{
          label: text.cancel,
          disabled: submitting || disabled,
          onCancel: () => void send({ reply: text.cancelReply }),
        }}
      >
        <View
          input={checked.input}
          project={shown}
          prepared={checked.prepared}
          facts={projectFacts}
          draft={draft}
          setDraft={(change) =>
            setDraft((current) => Object.assign({}, current, change))
          }
          submit={submit}
          submitting={submitting || disabled}
          answer={answered?.output}
          host={host}
          page={
            page === undefined
              ? undefined
              : {
                  close: page.close,
                  sendStaged: page.sendStaged,
                  stage: (compose) =>
                    page.stage(
                      compose === null
                        ? null
                        : (message) => answerWith(compose(message)),
                    ),
                }
          }
        />
        {fault === undefined ? null : <Fault>{fault}</Fault>}
      </ScreenCancel>
    );
  };
}

export type ScreenQuestionProps = {
  host: ComponentType<ScreenHostProps> | undefined;
  input: Record<string, unknown>;
  projectValues: ProjectValuesStore | undefined;
  answer: QuestionAnswer | undefined;
  disabled: boolean;
  onAnswer: ScreenHostProps["onAnswer"];
  supplies: HostSupplies | undefined;
  page?: PageHost | undefined;
};

/** The screen, or a plain notice when it has no view or no project to read. */
export function ScreenQuestion({
  host: Host,
  input,
  projectValues,
  answer,
  disabled,
  onAnswer,
  supplies,
  page,
}: ScreenQuestionProps) {
  if (answer !== undefined && "reply" in answer)
    return <SettledReply reply={answer.reply} />;
  if (
    Host === undefined ||
    projectValues === undefined ||
    supplies === undefined
  )
    return <InlineNote>{text.screenUnavailable}</InlineNote>;
  return (
    <Host
      input={input}
      output={
        answer !== undefined && "output" in answer ? answer.output : undefined
      }
      projectValues={projectValues}
      disabled={disabled}
      onAnswer={onAnswer}
      host={supplies}
      page={page}
    />
  );
}

/** In the conversation, a screen open over the room: the way back to it after it was closed. */
export function PageScreenCard({ onOpen }: { onOpen: () => void }) {
  return (
    <InlineNote>
      {text.pageScreenOpen}{" "}
      <Button type="button" size="sm" variant="outline" onClick={onOpen}>
        {text.pageScreenReopen}
      </Button>
    </InlineNote>
  );
}
