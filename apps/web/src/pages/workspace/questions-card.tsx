/**
 * The coordinator's open question as a card the person answers. The run log holds the question and,
 * once sent, the answer, so the card reads the same after a reload and settles when the answer lands.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, CornerDownRight } from "lucide-react";
import {
  Button,
  Checkbox,
  GateBlock,
  Input,
  IntakeForm,
} from "@corbits/react-ui";
import type { AskedQuestion } from "@intx/types/runtime-core";
import type { QuestionAnswer } from "@intx/types/signals";
import { wording } from "../../config.ts";
import type { QuestionsLayout } from "../../questions-layout-setting.ts";
import { clsx } from "clsx";
import { type } from "arktype";
import { Fault } from "../../components.jsx";
import { readJson } from "../../json.ts";
import styles from "./questions-card.module.css";

const text = wording.questions;

/** A question asked as prompts, as opposed to a plugin's screen. */
export type PromptsQuestion = Exclude<AskedQuestion, { plugin: string }>;

type Question = PromptsQuestion["questions"][number];

type Answer = {
  readonly chosen: readonly string[];
  readonly other: boolean;
  readonly otherText: string;
};

// Picks made before sending survive a reload of this tab, and are dropped once the answer is sent.
const Draft = type({
  "[string]": { chosen: "string[]", other: "boolean", otherText: "string" },
});
const draftKey = (id: string) => `question-draft:${id}`;

function readDraft(id: string): Record<string, Answer> {
  try {
    const raw = sessionStorage.getItem(draftKey(id));
    return (raw === null ? null : readJson(raw, Draft)) ?? {};
  } catch (error) {
    console.warn(
      "Browser storage is unavailable; picks last until a reload.",
      error,
    );
    return {};
  }
}

function writeDraft(id: string, answers: Record<string, Answer> | null): void {
  try {
    if (answers === null) sessionStorage.removeItem(draftKey(id));
    else sessionStorage.setItem(draftKey(id), JSON.stringify(answers));
  } catch (error) {
    console.warn(
      "Browser storage is unavailable; picks last until a reload.",
      error,
    );
  }
}

export type QuestionsState =
  | {
      readonly kind: "open";
      readonly disabled: boolean;
      /** Sends each question's answer under its id. */
      readonly onSend: (answers: Record<string, string[]>) => Promise<boolean>;
    }
  | { readonly kind: "answered"; readonly answer: QuestionAnswer };

function answerLabels(question: Question, answer: Answer): string[] {
  const labels = question.options
    .filter((option) => answer.chosen.includes(option.label))
    .map((option) => option.label);
  const own = answer.otherText.trim();
  return answer.other && own !== "" ? [...labels, own] : labels;
}

function complete(answer: Answer): boolean {
  if (answer.other) return answer.otherText.trim() !== "";
  return answer.chosen.length > 0;
}

type AnswerRow = { id: string; prompt: string; answer: string };

function AnswerList({ answers }: { answers: readonly AnswerRow[] }) {
  return (
    <dl className={styles.answers}>
      {answers.map(({ id, prompt, answer }) => (
        <div key={id}>
          <dt>{prompt}</dt>
          <dd>{answer}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The card once answered, the same in either layout: each question with its answer. */
function Settled({
  asked,
  answer,
}: {
  asked: PromptsQuestion;
  answer: QuestionAnswer;
}) {
  const mark = <Check className={clsx(styles.settledMark, styles.settledOk)} />;
  if ("reply" in answer) return <SettledReply reply={answer.reply} />;
  if (!("answers" in answer))
    throw new Error(
      "A question asked as prompts was answered with a screen's output.",
    );
  return (
    <SettledBox title={text.answered} mark={mark}>
      <AnswerList
        answers={asked.questions.map((question) => ({
          id: question.id,
          prompt: question.question,
          answer: (answer.answers[question.id] ?? []).join(", "),
        }))}
      />
    </SettledBox>
  );
}

/** Any open question once the person wrote back instead of answering it: what they wrote. */
export function SettledReply({ reply }: { reply: string }) {
  return (
    <SettledBox
      title={text.answeredInWords}
      mark={<CornerDownRight className={styles.settledMark} />}
    >
      <p className={styles.reply}>{reply}</p>
    </SettledBox>
  );
}

function SettledBox({
  title,
  mark,
  children,
}: {
  title: string;
  mark: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={styles.settled} aria-label={title}>
      <p className={styles.settledTitle}>
        {mark}
        {title}
      </p>
      {children}
    </section>
  );
}

function OtherInput({
  question,
  value,
  disabled,
  onChange,
  onKeyDown,
  onBlur,
}: {
  question: Question;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
}) {
  return (
    <Input
      autoFocus
      className={styles.otherInput}
      disabled={disabled}
      aria-label={`${question.question} ${text.otherAnswer}`}
      placeholder={text.other}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...(onKeyDown === undefined ? {} : { onKeyDown })}
      {...(onBlur === undefined ? {} : { onBlur })}
    />
  );
}

/** A value for the Other choice that none of the question's own options use. */
function otherValue(question: Question): string {
  let value = "other";
  while (question.options.some((option) => option.label === value))
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
  const allowOther = question.custom;
  const options = [
    ...question.options.map(({ label }) => ({ value: label, label })),
    ...(allowOther ? [{ value: other, label: text.other }] : []),
  ];
  return (
    <div className={styles.question}>
      <IntakeForm
        idPrefix={idPrefix}
        disabled={disabled}
        fields={[
          {
            name: question.id,
            label: question.question,
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
  return (
    <fieldset className={styles.question} disabled={disabled}>
      <legend>{question.question}</legend>
      {question.options.map((option) => (
        <Checkbox
          key={option.label}
          className={styles.option}
          label={option.label}
          {...(option.description === ""
            ? {}
            : { description: option.description })}
          checked={answer.chosen.includes(option.label)}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({
              ...answer,
              chosen: checked
                ? [...answer.chosen, option.label]
                : answer.chosen.filter((item) => item !== option.label),
            })
          }
        />
      ))}
      {question.custom ? (
        <MultiOther
          id={`${idPrefix}-${question.id}-other`}
          question={question}
          answer={answer}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
    </fieldset>
  );
}

/** Other on a multi-choice question: ticked, it becomes the field it names; left empty, it unticks. */
function MultiOther({
  id,
  question,
  answer,
  disabled,
  onChange,
}: {
  id: string;
  question: Question;
  answer: Answer;
  disabled: boolean;
  onChange: (answer: Answer) => void;
}) {
  const untick = () => onChange({ ...answer, other: false, otherText: "" });
  if (!answer.other)
    return (
      <Checkbox
        className={styles.option}
        label={text.other}
        checked={false}
        disabled={disabled}
        onCheckedChange={() => onChange({ ...answer, other: true })}
      />
    );
  return (
    <div className={styles.other}>
      <Checkbox
        id={id}
        className={styles.option}
        checked
        disabled={disabled}
        onCheckedChange={untick}
      />
      <OtherInput
        question={question}
        value={answer.otherText}
        disabled={disabled}
        onChange={(otherText) => onChange({ ...answer, otherText })}
        onBlur={() => {
          if (answer.otherText.trim() === "") untick();
        }}
      />
    </div>
  );
}

/** One question as a list answered from the keyboard: arrows move, Enter chooses, Space ticks. */
function StepQuestion({
  question,
  idPrefix,
  answer,
  disabled,
  focus,
  onChange,
  onDone,
  onBack,
}: {
  question: Question;
  idPrefix: string;
  answer: Answer;
  disabled: boolean;
  /** Whether the list takes focus as it opens: only once the person is moving through the steps. */
  focus: boolean;
  onChange: (answer: Answer) => void;
  /** Moves on, given the answer this step settled on. */
  onDone: (answer: Answer) => void;
  onBack: () => void;
}) {
  const multi = question.multiple;
  const allowOther = question.custom;
  const count = question.options.length + (allowOther ? 1 : 0);
  const otherIndex = allowOther ? question.options.length : -1;
  const [active, setActive] = useState(() => {
    if (answer.other) return otherIndex;
    const chosen = question.options.findIndex((option) =>
      answer.chosen.includes(option.label),
    );
    return Math.max(chosen, 0);
  });
  const list = useRef<HTMLDivElement>(null);
  // Focus follows the step as it opens, not each answer within it.
  const opening = useRef(focus && !answer.other);
  useEffect(() => {
    if (opening.current) list.current?.focus();
  }, []);

  const pick = (index: number): Answer => {
    if (index === otherIndex && !multi)
      return { chosen: [], other: true, otherText: answer.otherText };
    // On a multi-choice question Other ticks like any option, and unticking clears its text.
    if (index === otherIndex && answer.other)
      return { ...answer, other: false, otherText: "" };
    if (index === otherIndex) return { ...answer, other: true };
    const value = question.options[index]?.label;
    if (value === undefined) return answer;
    if (!multi) return { chosen: [value], other: false, otherText: "" };
    return {
      ...answer,
      chosen: answer.chosen.includes(value)
        ? answer.chosen.filter((item) => item !== value)
        : [...answer.chosen, value],
    };
  };
  const choose = (index: number) => {
    const next = pick(index);
    onChange(next);
    if (!multi && index !== otherIndex) onDone(next);
  };
  const leaveOther = () => {
    if (answer.otherText.trim() === "")
      onChange({ ...answer, other: false, otherText: "" });
    list.current?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.target !== event.currentTarget) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((index) => Math.min(index + 1, count - 1)),
      ArrowUp: () => setActive((index) => Math.max(index - 1, 0)),
      ArrowLeft: onBack,
      ArrowRight: () => {
        if (complete(answer)) onDone(answer);
      },
      " ": () => onChange(pick(active)),
      Enter: () => {
        // Back on an Other already chosen: its text answers the step, or the field takes focus again.
        if (active === otherIndex && answer.other) {
          if (complete(answer)) return onDone(answer);
          return list.current?.querySelector("input")?.focus();
        }
        if (!multi || active === otherIndex) return choose(active);
        if (complete(answer)) return onDone(answer);
        const next = pick(active);
        onChange(next);
        onDone(next);
      },
    };
    const run = keys[event.key];
    if (run === undefined) return;
    event.preventDefault();
    run();
  };
  const onOtherKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && complete(answer)) {
      event.preventDefault();
      onDone(answer);
    }
    if (event.key === "Escape" || event.key === "ArrowUp") {
      event.preventDefault();
      if (event.key === "ArrowUp") setActive(Math.max(otherIndex - 1, 0));
      leaveOther();
    }
  };

  const optionId = (index: number) => `${idPrefix}-${question.id}-${index}`;
  const chosen = (index: number) => {
    if (index === otherIndex) return answer.other;
    const option = question.options[index];
    return option !== undefined && answer.chosen.includes(option.label);
  };
  const rows = [
    ...question.options,
    ...(allowOther ? [{ label: text.other, description: "" }] : []),
  ];
  return (
    <div className={styles.question}>
      <p className={styles.prompt} id={`${idPrefix}-${question.id}`}>
        {question.question}
      </p>
      <div
        ref={list}
        role="listbox"
        tabIndex={disabled ? -1 : 0}
        className={styles.options}
        aria-labelledby={`${idPrefix}-${question.id}`}
        aria-multiselectable={multi}
        aria-activedescendant={optionId(active)}
        aria-disabled={disabled}
        onKeyDown={onListKey}
      >
        {rows.map(({ label, description }, index) =>
          index === otherIndex && answer.other ? (
            <div
              key={optionId(index)}
              id={optionId(index)}
              role="option"
              aria-selected
              className={styles.choice}
              data-active={active === index ? "" : undefined}
            >
              <Check
                className={styles.choiceMark}
                onClick={() => {
                  if (disabled || !multi) return;
                  onChange(pick(otherIndex));
                  list.current?.focus();
                }}
              />
              <OtherInput
                question={question}
                value={answer.otherText}
                disabled={disabled}
                onChange={(otherText) => onChange({ ...answer, otherText })}
                onKeyDown={onOtherKey}
                onBlur={() => {
                  if (answer.otherText.trim() === "")
                    onChange({ ...answer, other: false, otherText: "" });
                }}
              />
            </div>
          ) : (
            <div
              key={optionId(index)}
              id={optionId(index)}
              role="option"
              aria-selected={chosen(index)}
              aria-labelledby={`${optionId(index)}-label`}
              aria-describedby={
                description === ""
                  ? undefined
                  : `${optionId(index)}-description`
              }
              className={styles.choice}
              data-active={active === index ? "" : undefined}
              onClick={() => {
                if (disabled) return;
                setActive(index);
                if (multi && index !== otherIndex) list.current?.focus();
                choose(index);
              }}
            >
              {chosen(index) ? (
                <Check className={styles.choiceMark} />
              ) : (
                <span className={styles.choiceMark} />
              )}
              <span className={styles.choiceText}>
                <span id={`${optionId(index)}-label`}>{label}</span>
                {description !== "" && (
                  <span
                    id={`${optionId(index)}-description`}
                    className={styles.choiceDescription}
                  >
                    {description}
                  </span>
                )}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** Every answer before it is sent. Enter sends; ← goes back to the last question. */
function StepReview({
  questions,
  answerOf,
  focus,
  onBack,
  onSend,
  canSend,
  sending,
}: {
  questions: readonly Question[];
  answerOf: (question: Question) => Answer;
  focus: boolean;
  onBack: () => void;
  onSend: () => void;
  canSend: boolean;
  sending: boolean;
}) {
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft") return;
        event.preventDefault();
        onBack();
      }}
    >
      <AnswerList
        answers={questions.map((question) => ({
          id: question.id,
          prompt: question.question,
          answer: answerLabels(question, answerOf(question)).join(", "),
        }))}
      />
      <Button
        autoFocus={focus}
        type="button"
        size="sm"
        disabled={!canSend}
        onClick={onSend}
      >
        {sending ? text.sending : text.send}
      </Button>
    </div>
  );
}

function StepsBody({
  idPrefix,
  questions,
  answerOf,
  setAnswer,
  disabled,
  sending,
  onSend,
}: {
  idPrefix: string;
  questions: readonly Question[];
  answerOf: (question: Question) => Answer;
  setAnswer: (question: Question, answer: Answer) => void;
  disabled: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  // A draft kept through a reload resumes at its first unanswered question, or at Submit.
  const [start] = useState(() => {
    const unanswered = questions.findIndex((item) => !complete(answerOf(item)));
    return unanswered < 0 ? questions.length : unanswered;
  });
  const [step, setStep] = useState(start);
  const [moved, setMoved] = useState(false);
  // The furthest step reached: every question is seen in turn before Submit.
  const [furthest, setFurthest] = useState(start);
  const go = (next: number) => {
    const to = Math.max(0, Math.min(next, questions.length));
    setMoved(true);
    setStep(to);
    setFurthest((current) => Math.max(current, to));
  };
  const answeredAll = questions.every((item) => complete(answerOf(item)));
  const question = questions[step];
  return (
    <>
      <div role="tablist" aria-label={text.steps} className={styles.steps}>
        {[...questions.map((item) => item.header), text.submit].map(
          (name, index) => {
            const item = questions[index];
            const done =
              item !== undefined &&
              index < furthest &&
              complete(answerOf(item));
            return (
              <button
                key={`${String(index)}-${name}`}
                type="button"
                role="tab"
                aria-selected={index === step}
                className={styles.step}
                data-done={done ? "" : undefined}
                disabled={disabled || index > furthest}
                onClick={() => go(index)}
              >
                {done ? <Check className={styles.stepMark} /> : null}
                {name}
              </button>
            );
          },
        )}
      </div>
      {question === undefined ? (
        <StepReview
          questions={questions}
          answerOf={answerOf}
          focus={moved}
          onBack={() => go(step - 1)}
          onSend={onSend}
          canSend={!disabled && !sending && answeredAll}
          sending={sending}
        />
      ) : (
        <StepQuestion
          key={question.id}
          question={question}
          idPrefix={idPrefix}
          answer={answerOf(question)}
          disabled={disabled}
          focus={moved}
          onChange={(answer) => setAnswer(question, answer)}
          onDone={(answer) => {
            if (complete(answer)) go(step + 1);
          }}
          onBack={() => go(step - 1)}
        />
      )}
      <p className={styles.keys}>
        {question === undefined
          ? text.keys.review
          : text.keys[question.multiple ? "multi" : "single"]}
      </p>
    </>
  );
}

export function QuestionsCard({
  id,
  asked,
  state,
  layout,
}: {
  /** The question's signal, so each card's field ids are its own. */
  id: string;
  asked: PromptsQuestion;
  state: QuestionsState;
  layout: QuestionsLayout;
}) {
  const [answers, setAnswers] = useState(() => readDraft(id));
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const settled = state.kind === "answered";
  useEffect(() => {
    if (settled) writeDraft(id, null);
    else if (Object.keys(answers).length > 0) writeDraft(id, answers);
  }, [id, answers, settled]);
  if (settled) return <Settled asked={asked} answer={state.answer} />;
  const answerOf = (question: Question): Answer =>
    answers[question.id] ?? { chosen: [], other: false, otherText: "" };
  const setAnswer = (question: Question, next: Answer) =>
    setAnswers((current) => ({ ...current, [question.id]: next }));
  const ready = asked.questions.every((question) =>
    complete(answerOf(question)),
  );
  const disabled = state.disabled || sending;
  const send = async () => {
    setSending(true);
    setFailed(false);
    const sent = await state.onSend(
      Object.fromEntries(
        asked.questions.map((question) => [
          question.id,
          answerLabels(question, answerOf(question)),
        ]),
      ),
    );
    // Once sent, the card stays sending until the run log shows the answer and it settles.
    if (sent) return;
    setSending(false);
    setFailed(true);
  };
  const notSent = failed ? <Fault>{text.notSent}</Fault> : undefined;
  const gate = {
    kind: "form" as const,
    title: text.title(asked.questions.length),
  };
  if (layout === "steps")
    return (
      <GateBlock
        className={styles.card}
        gate={gate}
        {...(notSent === undefined ? {} : { footer: notSent })}
      >
        <StepsBody
          idPrefix={id}
          questions={asked.questions}
          answerOf={answerOf}
          setAnswer={setAnswer}
          disabled={disabled}
          sending={sending}
          onSend={() => void send()}
        />
      </GateBlock>
    );
  return (
    <GateBlock
      className={styles.card}
      gate={gate}
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
          {notSent}
        </>
      }
    >
      <div className={styles.fields}>
        {asked.questions.map((question) => {
          const answer = answerOf(question);
          const onChange = (next: Answer) => setAnswer(question, next);
          if (question.multiple)
            return (
              <MultiField
                key={question.id}
                question={question}
                idPrefix={id}
                answer={answer}
                disabled={disabled}
                onChange={onChange}
              />
            );
          // A select hides each option's description until one is picked, so options that explain
          // themselves are listed instead.
          if (question.options.some((option) => option.description !== ""))
            return (
              <StepQuestion
                key={question.id}
                question={question}
                idPrefix={id}
                answer={answer}
                disabled={disabled}
                focus={false}
                onChange={onChange}
                onDone={onChange}
                onBack={() => undefined}
              />
            );
          return (
            <SingleField
              key={question.id}
              question={question}
              idPrefix={id}
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
