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
import { wording } from "../../config.ts";
import { Fault, InlineNote } from "../../components.jsx";
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

export type ScreenHostProps = {
  input: Record<string, unknown>;
  output: Record<string, unknown> | undefined;
  projectValues: ProjectValuesStore;
  disabled: boolean;
  onAnswer: (answer: QuestionAnswer) => Promise<boolean>;
};

/** One plugin's screen, typed end to end, behind props every plugin shares. */
export function screenHost<In, Out, Data, Prepared>(
  builder: Builder,
  plugin: {
    screen: Screen<In, Out, Data, Prepared>;
    view: ComponentType<
      ScreenViewProps<Type<In>["infer"], Type<Out>["infer"], Prepared>
    >;
    data: Type<Data>["infer"];
    /** Each project value the manifest writes, taken from the screen's output. */
    writes: Record<string, (output: Type<Out>["infer"]) => string>;
  },
): ComponentType<ScreenHostProps> {
  const { screen, view: View, data, writes } = plugin;
  const { handle, reads = [] } = builder;
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
          setProject(await projectValues.read(reads, abort.signal));
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

    const submit = async (chosen: Type<Out>["infer"]) => {
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
        return;
      }
      // Once sent, the screen stays submitting until the run log shows the answer and it settles.
      if (await onAnswer(QuestionAnswer.assert({ output: result.output })))
        return;
      setSubmitting(false);
      setFault(text.notSent);
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
        />
        {fault === undefined ? null : <Fault>{fault}</Fault>}
      </>
    );
  };
}

/** The screen in the conversation, or a plain notice when it has no view or no project to read. */
export function ScreenQuestion({
  host: Host,
  input,
  projectValues,
  answer,
  disabled,
  onAnswer,
}: {
  host: ComponentType<ScreenHostProps> | undefined;
  input: Record<string, unknown>;
  projectValues: ProjectValuesStore | undefined;
  answer: QuestionAnswer | undefined;
  disabled: boolean;
  onAnswer: ScreenHostProps["onAnswer"];
}) {
  if (answer !== undefined && "reply" in answer)
    return <SettledReply reply={answer.reply} />;
  if (Host === undefined || projectValues === undefined)
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
    />
  );
}
