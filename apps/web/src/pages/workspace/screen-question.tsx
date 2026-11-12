/**
 * A question the coordinator asked as a plugin's screen. The plugin, not the agent, decides what is
 * drawn: its view gets the project's values it reads, the checked input and the draft. Its output is
 * saved to the project values it writes, then answers the question.
 */
import { useEffect, useState, type ComponentType } from "react";
import type { Type } from "arktype";
import {
  checkInput,
  checkOutput,
  type Builder,
  type ProjectValues,
  type Screen,
  type ScreenViewProps,
} from "@corbits-builder/plugin";
import { QuestionAnswer } from "@intx/types/signals";
import { Button } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Fault, InlineNote } from "../../components.jsx";
import type { DesignFiles } from "./design-bundle.ts";
import type { MockupFrameProps } from "./mockup-frame.tsx";
import { SettledReply } from "./questions-card.tsx";

const text = wording.questions;

// The project's facts, which gate options such as paid fonts. None reach the interface yet.
export const projectFacts: readonly string[] = [];

/** Reads and saves the open project's values by name. */
export type ProjectValuesStore = {
  read(
    keys: readonly string[],
    signal: AbortSignal,
  ): Promise<Record<string, string | null>>;
  save(values: Record<string, string>): Promise<unknown>;
};

/** The design a screen reviews, and whether the person's approval of it can be recorded here. */
export type ReviewedDesign = {
  files: DesignFiles;
  version: number | "draft";
  approval: { approve(): Promise<void> } | { unavailable: string };
};

/** What the interface itself supplies a screen's view, by the names a manifest lists under host. */
export type HostSupplies = {
  /** The live draft while a designer works, else the newest filed design or design option. */
  design: ReviewedDesign | null;
  /** A design bundle drawn in the design pane's own sandboxed frame. */
  mockupFrame: ComponentType<MockupFrameProps>;
  /** The output of the latest question the coordinator asked with the same screen, if answered. */
  earlierAnswer: unknown;
};

const SUPPLIED: ReadonlySet<string> = new Set<keyof HostSupplies>([
  "design",
  "mockupFrame",
  "earlierAnswer",
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

/** One plugin's screen, typed end to end, behind props every plugin shares. */
export function screenHost<In, Out, Data, Prepared>(
  builder: Builder,
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
    /** Each project value the manifest writes, taken from the screen's output. */
    writes: Record<string, (output: Type<Out>["infer"]) => string>;
  },
): ComponentType<ScreenHostProps> {
  const { screen, view: View, data, writes } = plugin;
  const { handle, reads = [], host: supplied = [] } = builder;
  const unknown = supplied.find((name) => !SUPPLIED.has(name));
  if (unknown !== undefined)
    throw new Error(
      `${handle} asks for ${unknown}, which this interface does not supply.`,
    );
  const mapped = Object.keys(writes).sort().join(", ");
  if (mapped !== [...(builder.writes ?? [])].sort().join(", "))
    throw new Error(
      `${handle}'s screen maps "${mapped}", not the values its manifest writes.`,
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
    const checked = checkInput(handle, screen, input, data, shown);
    const answered =
      output === undefined ? undefined : checkOutput(handle, screen, output);
    if (!checked.ok || checked.prepared === undefined || answered?.ok === false)
      return <InlineNote>{text.screenUnavailable}</InlineNote>;

    // Whether the answer reached the hub; a fault is the screen's to show.
    const answerWith = async (chosen: Type<Out>["infer"]) => {
      const result = checkOutput(handle, screen, chosen);
      if (!result.ok) throw new Error(result.text);
      setSubmitting(true);
      setFault(undefined);
      const changed: Record<string, string> = {};
      for (const [name, from] of Object.entries(writes)) {
        const value = from(result.output);
        if (value !== shown[name]) changed[name] = value;
      }
      try {
        if (Object.keys(changed).length > 0) await projectValues.save(changed);
      } catch (cause) {
        console.warn(`${handle} could not save the project's values.`, cause);
        setSubmitting(false);
        setFault(text.screenNotSaved);
        return false;
      }
      // Once sent, the screen stays submitting until the run log shows the answer and it settles.
      if (await onAnswer(QuestionAnswer.assert({ output: result.output })))
        return true;
      setSubmitting(false);
      setFault(text.notSent);
      return false;
    };
    const submit = async (chosen: Type<Out>["infer"]) => {
      await answerWith(chosen);
    };
    return (
      <>
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
      </>
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
