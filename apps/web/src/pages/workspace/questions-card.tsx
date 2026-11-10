/**
 * The coordinator's ask_questions call as a card the person answers one question at a time. The
 * answers go back as the person's next message, the way the composer sends one; the card holds no
 * state of its own past that message, so a later person turn is what marks it answered.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  CornerDownLeft,
  CornerDownRight,
  Pencil,
  Plus,
} from "lucide-react";
import { Button, GateBlock, type PartTool } from "@corbits/react-ui";
import { Tooltip } from "@corbits/react-ui/ui/tooltip";
import {
  AskQuestions,
  askQuestionsIssue,
  type Question,
} from "@corbits-builder/schemas/questions";
import { wording } from "../../config.ts";
import type { CallResult } from "./live-run.ts";
import { Fault } from "../../components.jsx";
import styles from "./questions-card.module.css";

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

export type QuestionsState =
  | {
      readonly kind: "open";
      readonly disabled: boolean;
      readonly onSend: (reply: string) => Promise<boolean>;
    }
  | { readonly kind: "answered"; readonly reply: string }
  | { readonly kind: "replaced" };

/** The options picked, plus the person's own words; typing those is the "Something else" answer. */
type Answer = { readonly chosen: readonly string[]; readonly own: string };

/** The coordinator's recommended answer picked to start with; a question it recommends nothing for starts blank. */
function startingAnswer(question: Question): Answer {
  if (question.preselected === undefined) return { chosen: [], own: "" };
  return { chosen: question.preselected, own: "" };
}

function answered(answer: Answer): boolean {
  return answer.chosen.length > 0 || answer.own.trim() !== "";
}

function answerLabels(question: Question, answer: Answer): string[] {
  const labels = question.options
    .filter((option) => answer.chosen.includes(option.value))
    .map((option) => option.label);
  const own = answer.own.trim();
  return own === "" ? labels : [...labels, own];
}

/** Option `index` picked: the only choice on a pick-one question, toggled on a pick-any one. */
function pick(question: Question, answer: Answer, index: number): Answer {
  const value = question.options[index]?.value;
  if (value === undefined) return answer;
  if (question.kind === "single") return { chosen: [value], own: "" };
  return {
    ...answer,
    chosen: answer.chosen.includes(value)
      ? answer.chosen.filter((item) => item !== value)
      : [...answer.chosen, value],
  };
}

/** What a key does on the open card, by where focus is. */
export type KeyIntent =
  | { kind: "next" }
  | { kind: "forward" }
  | { kind: "back" }
  | { kind: "move"; by: 1 | -1 }
  | { kind: "pick"; index: number }
  | { kind: "pickFocused" };

export type KeyTarget = "option" | "own" | "button" | "other";

/**
 * Enter continues (or sends, on the last question); → moves on without ever sending; ← goes back;
 * ↑↓ move between the options; Space and 1–9 pick. ← → and digits are left to the own-words field
 * for typing, and Enter to a focused button so Back and the answered rows still click.
 */
export function keyIntent(
  key: string,
  target: KeyTarget,
): KeyIntent | undefined {
  const typing = target === "own";
  if (key === "Enter")
    return target === "button" ? undefined : { kind: "next" };
  if (key === "ArrowDown") return { kind: "move", by: 1 };
  if (key === "ArrowUp" || (key === "Escape" && typing))
    return { kind: "move", by: -1 };
  if (typing) return undefined;
  if (key === "ArrowRight") return { kind: "forward" };
  if (key === "ArrowLeft") return { kind: "back" };
  if (key === " " && target === "option") return { kind: "pickFocused" };
  if (/^[1-9]$/.test(key)) return { kind: "pick", index: Number(key) - 1 };
  return undefined;
}

function keyTarget(element: EventTarget): KeyTarget {
  if (element instanceof HTMLButtonElement) return "button";
  if (!(element instanceof HTMLInputElement)) return "other";
  return element.type === "text" ? "own" : "option";
}

/** Each question with its answer as the person's reply carries it, by the line the card composed. */
function repliedAnswers(
  questions: readonly Question[],
  reply: string,
): AnswerRow[] {
  const lines = reply.split("\n");
  return questions.flatMap((question) => {
    const lead = text.answerLine(question.prompt, []);
    const line = lines.find((candidate) => candidate.startsWith(lead));
    return line === undefined
      ? []
      : [
          {
            id: question.id,
            prompt: question.prompt,
            answer: line.slice(lead.length),
          },
        ];
  });
}

type AnswerRow = { id: string; prompt: string; answer: string };

/**
 * The card once done: a one-line receipt. The answers are the person's reply right below it, so
 * the list stays folded until asked for.
 */
function Settled({ ask, reply }: { ask: AskQuestions; reply?: string }) {
  const [shown, setShown] = useState(false);
  const listId = useId();
  if (reply === undefined)
    return (
      <section className={styles.settled} aria-label={text.replaced}>
        <p className={styles.settledTitle}>
          <CornerDownRight className={styles.settledMark} aria-hidden />
          {text.replaced}
        </p>
      </section>
    );
  const answers = repliedAnswers(ask.questions, reply);
  const title = answers.length === 0 ? text.answeredInChat : text.answered;
  return (
    <section className={styles.settled} aria-label={title}>
      <p className={styles.settledTitle}>
        <Check className={styles.settledMark} data-ok="" aria-hidden />
        {title}
        {answers.length === 0 ? null : (
          <>
            <span className={styles.settledCount}>
              {text.answerCount(answers.length)}
            </span>
            <button
              type="button"
              className={styles.settledToggle}
              aria-expanded={shown}
              aria-controls={shown ? listId : undefined}
              onClick={() => setShown(!shown)}
            >
              {shown ? text.hide : text.show}
              <ChevronDown aria-hidden />
            </button>
          </>
        )}
      </p>
      {shown ? (
        <dl id={listId} className={styles.answers}>
          {answers.map(({ id, prompt, answer }) => (
            <div key={id}>
              <dt>{prompt}</dt>
              <dd>{answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

type Mark = "done" | "current" | "upcoming" | "folded";

function ThreadMark({ mark }: { mark: Mark }) {
  return (
    <span className={styles.mark} data-mark={mark} aria-hidden>
      {mark === "done" ? <Check /> : null}
    </span>
  );
}

function AnsweredRow({
  question,
  answer,
  disabled,
  onOpen,
}: {
  question: Question;
  answer: Answer;
  disabled: boolean;
  onOpen: () => void;
}) {
  const labels = answerLabels(question, answer).join(", ");
  return (
    <li className={styles.row}>
      <ThreadMark mark="done" />
      <button
        type="button"
        className={styles.answered}
        disabled={disabled}
        aria-label={text.changeAnswer(question.prompt, labels)}
        onClick={onOpen}
      >
        <span className={styles.answeredPrompt}>{question.prompt}</span>
        <span className={styles.answeredValue}>{labels}</span>
        <Pencil className={styles.answeredEdit} aria-hidden />
      </button>
    </li>
  );
}

function Choices({
  name,
  question,
  answer,
  ruleId,
  disabled,
  onPick,
  onOwn,
}: {
  name: string;
  question: Question;
  answer: Answer;
  ruleId: string;
  disabled: boolean;
  onPick: (index: number) => void;
  onOwn: (own: string) => void;
}) {
  const multi = question.kind === "multi";
  const picked = answer.chosen.length;
  return (
    <fieldset
      className={styles.question}
      disabled={disabled}
      aria-describedby={ruleId}
    >
      <legend className={styles.prompt}>{question.prompt}</legend>
      <p id={ruleId} className={styles.rule}>
        {multi ? text.pickAny : text.pickOne}
        {multi && picked > 0 ? (
          <span className={styles.ruleCount}>
            {text.selected(picked, question.options.length)}
          </span>
        ) : null}
      </p>
      <div className={styles.choices} data-kind={question.kind}>
        {question.options.map((option, index) => {
          const checked = answer.chosen.includes(option.value);
          return (
            <label
              key={option.value}
              className={styles.choice}
              data-checked={checked ? "" : undefined}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                name={name}
                checked={checked}
                aria-keyshortcuts={String(index + 1)}
                onChange={() => onPick(index)}
                onClick={(event) => {
                  // Safari leaves focus where it was on a click; the card's keys need it here.
                  event.currentTarget.focus();
                  // A checked radio fires no change, so a click on the recommended answer moves on here.
                  if (checked && !multi) onPick(index);
                }}
              />
              <span className={styles.box} aria-hidden>
                {checked ? <Check /> : index + 1}
              </span>
              {option.label}
            </label>
          );
        })}
        {question.allowOther === true ? (
          <label
            className={styles.choice}
            data-checked={answer.own.trim() === "" ? undefined : ""}
          >
            <span className={styles.box} aria-hidden>
              <Plus />
            </span>
            <input
              type="text"
              className={styles.own}
              aria-label={text.otherAnswer}
              placeholder={text.other}
              value={answer.own}
              onChange={(event) => onOwn(event.target.value)}
            />
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}

/** Continue moves on; on the last question it sends instead. */
function nextLabel(last: boolean, sending: boolean): string {
  if (!last) return text.next;
  return sending ? text.sending : text.send;
}

/** Where the person is: their answers, the open question, and whether the last send failed. */
type Draft = {
  readonly answers: readonly Answer[];
  readonly step: number;
  readonly failed: boolean;
  /**
   * The card takes focus only once the person has stepped or sent, never as it appears, so keys
   * meant for the composer stay there; from then on focus follows the open question.
   */
  readonly focusFollows: boolean;
};

function OpenCard({
  id,
  ask,
  blocked,
  onSend,
  draft,
  onDraft,
}: {
  id: string;
  ask: AskQuestions;
  /** Closed to answers for now, such as while another message is sending. */
  blocked: boolean;
  onSend: (reply: string) => Promise<boolean>;
  draft: Draft;
  onDraft: Dispatch<SetStateAction<Draft>>;
}) {
  const { questions } = ask;
  const { answers, step, failed, focusFollows } = draft;
  const [earlierShown, setEarlierShown] = useState(false);
  const [sending, setSending] = useState(false);
  const choices = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  const question = questions[step];
  useEffect(() => {
    if (!focusFollows || choices.current === null) return;
    const inputs = [...choices.current.querySelectorAll("input")];
    const target = inputs.find((input) => input.checked) ?? inputs[0];
    target?.focus();
  }, [step, focusFollows]);
  if (question === undefined) return null;

  const answerOf = (index: number): Answer =>
    answers[index] ?? { chosen: [], own: "" };
  const answer = answerOf(step);
  const last = step === questions.length - 1;
  const ready = answered(answer);
  const disabled = blocked || sending;
  const setAnswer = (next: Answer) =>
    onDraft((current) => ({
      ...current,
      answers: current.answers.map((item, index) =>
        index === step ? next : item,
      ),
    }));
  const go = (to: number) =>
    onDraft((current) => ({
      ...current,
      step: Math.max(0, Math.min(to, questions.length - 1)),
      focusFollows: true,
    }));
  const send = async () => {
    // The options lock while sending; holding focus on Send lets Enter retry if it fails.
    nextButton.current?.focus();
    setSending(true);
    onDraft((current) => ({ ...current, failed: false, focusFollows: true }));
    const reply = questions
      .map((item, index) =>
        text.answerLine(item.prompt, answerLabels(item, answerOf(index))),
      )
      .join("\n");
    const sent = await onSend(reply);
    setSending(false);
    onDraft((current) => ({ ...current, failed: !sent }));
  };
  const next = () => {
    if (disabled || !ready) return;
    if (last) void send();
    else go(step + 1);
  };
  // A pick-one question moves on once picked, except the last: only the person sends.
  const choose = (index: number) => {
    if (question.options[index] === undefined) return;
    setAnswer(pick(question, answer, index));
    if (question.kind === "single" && !last) go(step + 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    // Safari sends the Enter that ends an IME composition after it ends, marked only by keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const intent = keyIntent(event.key, keyTarget(event.target));
    if (intent === undefined) return;
    event.preventDefault();
    // A held key acts once, so it cannot run through the questions and send; ↑↓ may repeat.
    if (event.repeat && intent.kind !== "move") return;
    if (choices.current === null) return;
    const inputs = [...choices.current.querySelectorAll("input")];
    const at = inputs.findIndex((input) => input === event.target);
    switch (intent.kind) {
      case "next":
        return next();
      case "forward":
        return ready && !last ? go(step + 1) : undefined;
      case "back":
        return step > 0 ? go(step - 1) : undefined;
      case "pick":
        return choose(intent.index);
      case "pickFocused":
        // Space only picks: on a pick-one question it does not move on the way a click does.
        return setAnswer(pick(question, answer, at));
      case "move": {
        // From the buttons, ↓ enters the options at the first and ↑ at the last.
        const from = at === -1 && intent.by < 0 ? inputs.length : at;
        return inputs[
          Math.max(0, Math.min(from + intent.by, inputs.length - 1))
        ]?.focus();
      }
    }
  };

  const earlier = questions.slice(0, Math.max(0, step - 1));
  const previous = step > 0 ? step - 1 : undefined;
  const upcoming = questions[step + 1];
  const more = questions.length - step - 2;
  const ruleId = `${id}-${question.id}-rule`;
  const answeredRow = (index: number) => {
    const item = questions[index];
    return item === undefined ? null : (
      <AnsweredRow
        key={item.id}
        question={item}
        answer={answerOf(index)}
        disabled={disabled}
        onOpen={() => go(index)}
      />
    );
  };

  return (
    <GateBlock
      className={styles.card}
      gate={{ kind: "form", title: text.title(questions.length) }}
    >
      {/* Keys act anywhere in the card, from the options to the buttons, and nowhere else. */}
      <div onKeyDown={onKeyDown}>
        {questions.length > 1 ? (
          <p className={styles.position} aria-live="polite">
            {text.position(step + 1, questions.length)}
          </p>
        ) : null}
        <ol className={styles.thread} aria-label={text.thread}>
          {earlier.length > 0 ? (
            <li className={styles.row}>
              <ThreadMark mark="folded" />
              <button
                type="button"
                className={styles.fold}
                aria-expanded={earlierShown}
                onClick={() => setEarlierShown(!earlierShown)}
              >
                {text.earlier(earlier.length)}
                <ChevronDown aria-hidden />
              </button>
            </li>
          ) : null}
          {earlierShown ? earlier.map((_, index) => answeredRow(index)) : null}
          {previous === undefined ? null : answeredRow(previous)}
          <li className={styles.row} aria-current="step">
            <ThreadMark mark="current" />
            <div ref={choices}>
              <Choices
                key={question.id}
                name={`${id}-${question.id}`}
                question={question}
                answer={answer}
                ruleId={ruleId}
                disabled={disabled}
                onPick={choose}
                onOwn={(own) =>
                  // On a pick-one question the person's own words replace the option picked.
                  setAnswer({
                    chosen: question.kind === "single" ? [] : answer.chosen,
                    own,
                  })
                }
              />
            </div>
          </li>
          {upcoming === undefined ? null : (
            <li className={styles.row} data-upcoming="">
              <ThreadMark mark="upcoming" />
              <span className={styles.upcoming}>
                {upcoming.prompt}
                {more > 0 ? <span>{text.more(more)}</span> : null}
              </span>
            </li>
          )}
        </ol>
        <div className={styles.footer}>
          <Tooltip label={text.backKeys}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={styles.back}
              data-hidden={step === 0 ? "" : undefined}
              disabled={disabled}
              aria-keyshortcuts="ArrowLeft"
              onClick={() => go(step - 1)}
            >
              <ChevronLeft aria-hidden />
              {text.back}
            </Button>
          </Tooltip>
          {failed ? <Fault>{text.notSent}</Fault> : null}
          <Tooltip label={last ? text.sendKeys : text.nextKeys}>
            <Button
              ref={nextButton}
              type="button"
              size="sm"
              className={styles.next}
              aria-disabled={disabled || !ready}
              aria-describedby={ruleId}
              aria-keyshortcuts={last ? "Enter" : "Enter ArrowRight"}
              onClick={next}
            >
              {nextLabel(last, sending)}
              <CornerDownLeft aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>
    </GateBlock>
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
  // Held above the open card: sending settles it at once, and a failed send reopens it as it was.
  const [draft, setDraft] = useState<Draft>(() => ({
    answers: ask.questions.map(startingAnswer),
    step: 0,
    failed: false,
    focusFollows: false,
  }));
  if (state.kind === "answered")
    return <Settled ask={ask} reply={state.reply} />;
  if (state.kind === "replaced") return <Settled ask={ask} />;
  return (
    <OpenCard
      id={id}
      ask={ask}
      blocked={state.disabled}
      onSend={state.onSend}
      draft={draft}
      onDraft={setDraft}
    />
  );
}
