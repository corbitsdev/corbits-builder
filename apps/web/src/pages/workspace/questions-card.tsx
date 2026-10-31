/**
 * The coordinator's ask_questions call as a card the person answers. The answers go back as the
 * person's next message, the way the composer sends one; the card holds no state of its own past
 * that message, so a later person turn is what marks it answered.
 */
import { useState } from "react";
import { Check, CornerDownRight } from "lucide-react";
import {
  Button,
  Checkbox,
  ConversationNotice,
  GateBlock,
  Input,
  IntakeForm,
  type PartTool,
} from "@corbits/react-ui";
import {
  AskQuestions,
  askQuestionsIssue,
  type Question,
} from "@corbits-builder/schemas/questions";
import { wording } from "../../config.ts";
import type { CallResult } from "./live-run.ts";
import "./questions-card.css";

const text = wording.questions;

export const ASK_QUESTIONS = "ask_questions";

/** The questions a finished call asked, or undefined when it is not one the hub accepted. */
export function askedQuestions(
  part: PartTool,
  result: CallResult | undefined,
): AskQuestions | undefined {
  if (part.name !== ASK_QUESTIONS || part.status !== "output-available")
    return undefined;
  if (result?.isError === true || !AskQuestions.allows(part.input))
    return undefined;
  return askQuestionsIssue(part.input) === undefined ? part.input : undefined;
}

type Answer = {
  readonly chosen: readonly string[];
  readonly other: boolean;
  readonly otherText: string;
};

export type QuestionsState =
  | {
      readonly kind: "open";
      readonly disabled: boolean;
      readonly onSend: (reply: string) => Promise<boolean>;
    }
  | { readonly kind: "answered"; readonly reply: string }
  | { readonly kind: "replaced" };

function answerLabels(question: Question, answer: Answer): string[] {
  const labels = question.options
    .filter((option) => answer.chosen.includes(option.value))
    .map((option) => option.label);
  const own = answer.otherText.trim();
  return answer.other && own !== "" ? [...labels, own] : labels;
}

function complete(answer: Answer): boolean {
  if (answer.other) return answer.otherText.trim() !== "";
  return answer.chosen.length > 0;
}

/** Each question's answer as the person's reply carries it, by the line the card composed. */
function repliedAnswers(
  questions: readonly Question[],
  reply: string,
): string[] {
  const lines = reply.split("\n");
  return questions.flatMap((question) => {
    const lead = text.answerLine(question.prompt, []);
    const line = lines.find((candidate) => candidate.startsWith(lead));
    return line === undefined ? [] : [line.slice(lead.length)];
  });
}

function Settled({ ask, reply }: { ask: AskQuestions; reply?: string }) {
  if (reply === undefined)
    return (
      <ConversationNotice
        className="questions-card-settled"
        icon={<CornerDownRight />}
      >
        <span>{text.replaced}</span>
      </ConversationNotice>
    );
  const answers = repliedAnswers(ask.questions, reply);
  return (
    <ConversationNotice
      className="questions-card-settled"
      icon={<Check className="questions-card-settled-ok" />}
    >
      <span>
        {answers.length === 0 ? text.answeredInChat : text.answered(answers)}
      </span>
    </ConversationNotice>
  );
}

function OtherInput({
  question,
  value,
  disabled,
  onChange,
}: {
  question: Question;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      className="questions-card-other-input"
      disabled={disabled}
      aria-label={`${question.prompt} ${text.otherAnswer}`}
      placeholder={text.otherAnswer}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** A value for the Other choice that none of the question's own options use. */
function otherValue(question: Question): string {
  let value = "other";
  while (question.options.some((option) => option.value === value))
    value += "_";
  return value;
}

function SingleField({
  question,
  idPrefix,
  answer,
  disabled,
  onChange,
}: {
  question: Question;
  idPrefix: string;
  answer: Answer;
  disabled: boolean;
  onChange: (answer: Answer) => void;
}) {
  const other = otherValue(question);
  const allowOther = question.allowOther === true;
  const options = allowOther
    ? [...question.options, { value: other, label: text.other }]
    : question.options;
  return (
    <div className="questions-card-question">
      <IntakeForm
        idPrefix={idPrefix}
        disabled={disabled}
        fields={[
          {
            name: question.id,
            label: question.prompt,
            type: "select",
            required: true,
            options,
          },
        ]}
        values={{
          [question.id]: answer.other ? other : (answer.chosen[0] ?? ""),
        }}
        onChange={(values) => {
          const value = values[question.id];
          if (typeof value !== "string") return;
          onChange(
            allowOther && value === other
              ? { ...answer, chosen: [], other: true }
              : {
                  ...answer,
                  chosen: value === "" ? [] : [value],
                  other: false,
                },
          );
        }}
      />
      {answer.other ? (
        <OtherInput
          question={question}
          value={answer.otherText}
          disabled={disabled}
          onChange={(otherText) => onChange({ ...answer, otherText })}
        />
      ) : null}
    </div>
  );
}

function MultiField({
  question,
  answer,
  disabled,
  onChange,
}: {
  question: Question;
  answer: Answer;
  disabled: boolean;
  onChange: (answer: Answer) => void;
}) {
  return (
    <fieldset className="questions-card-question" disabled={disabled}>
      <legend>{question.prompt}</legend>
      {question.options.map((option) => (
        <Checkbox
          key={option.value}
          className="questions-card-option"
          label={option.label}
          checked={answer.chosen.includes(option.value)}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({
              ...answer,
              chosen: checked
                ? [...answer.chosen, option.value]
                : answer.chosen.filter((item) => item !== option.value),
            })
          }
        />
      ))}
      {question.allowOther === true ? (
        <div className="questions-card-other">
          <Checkbox
            className="questions-card-option"
            label={text.other}
            checked={answer.other}
            disabled={disabled}
            onCheckedChange={(other) => onChange({ ...answer, other })}
          />
          <OtherInput
            question={question}
            value={answer.otherText}
            disabled={disabled}
            onChange={(otherText) =>
              onChange({
                ...answer,
                other: otherText !== "" || answer.other,
                otherText,
              })
            }
          />
        </div>
      ) : null}
    </fieldset>
  );
}

export function QuestionsCard({
  id,
  ask,
  state,
}: {
  /** The call's id, so each card's field ids are its own. */
  id: string;
  ask: AskQuestions;
  state: QuestionsState;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(
      ask.questions.map((question) => [
        question.id,
        { chosen: question.preselected ?? [], other: false, otherText: "" },
      ]),
    ),
  );
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (state.kind === "answered")
    return <Settled ask={ask} reply={state.reply} />;
  if (state.kind === "replaced") return <Settled ask={ask} />;
  const answerOf = (question: Question): Answer =>
    answers[question.id] ?? { chosen: [], other: false, otherText: "" };
  const ready = ask.questions.every((question) => complete(answerOf(question)));
  const disabled = state.disabled || sending;
  const send = async () => {
    setSending(true);
    setFailed(false);
    const reply = ask.questions
      .map((question) =>
        text.answerLine(
          question.prompt,
          answerLabels(question, answerOf(question)),
        ),
      )
      .join("\n");
    const sent = await state.onSend(reply);
    setSending(false);
    setFailed(!sent);
  };
  return (
    <GateBlock
      className="questions-card"
      gate={{ kind: "form", title: text.title }}
      footer={
        <>
          <Button
            type="button"
            size="sm"
            disabled={disabled || !ready}
            onClick={() => void send()}
          >
            {sending ? text.sending : text.send}
          </Button>
          {failed ? (
            <p className="inline-note" role="alert">
              {text.notSent}
            </p>
          ) : null}
        </>
      }
    >
      <div className="questions-card-fields">
        {ask.questions.map((question) => {
          const answer = answerOf(question);
          const onChange = (next: Answer) =>
            setAnswers((current) => ({ ...current, [question.id]: next }));
          return question.kind === "single" ? (
            <SingleField
              key={question.id}
              question={question}
              idPrefix={id}
              answer={answer}
              disabled={disabled}
              onChange={onChange}
            />
          ) : (
            <MultiField
              key={question.id}
              question={question}
              answer={answer}
              disabled={disabled}
              onChange={onChange}
            />
          );
        })}
      </div>
    </GateBlock>
  );
}
