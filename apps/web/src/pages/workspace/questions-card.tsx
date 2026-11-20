import { useQuestionOutcome } from "./question-outcome.tsx";
/**
 * The coordinator's open question as a card the person answers one question at a time. The run log
 * holds the question and, once sent, the answer, so the card reads the same after a reload.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  CornerDownLeft,
  Pencil,
  Plus,
} from "lucide-react";
import { Button, Checkbox, GateBlock } from "@corbits/react-ui";
import { Tooltip } from "@corbits/react-ui/ui/tooltip";
import {
  SettledAnswers,
  SettledFrame,
} from "@corbits-builder/plugin-ui/screen-card";
import {
  ActionsSlot,
  usePromptPlaceholder,
  usePromptSend,
} from "@corbits-builder/plugin-ui/screen-actions";
import type {
  PromptQuestion,
  QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { type } from "arktype";
import { useUnsent } from "../../unsent.ts";
import { wording } from "../../config.ts";
import { Fault } from "../../components.jsx";
import styles from "./questions-card.module.css";

const text = wording.questions;

type Asked = PromptQuestion["asked"];
type Question = Asked["questions"][number];

/**
 * The options picked, by label, plus the person's own words; typing those is the "Something else"
 * answer. Details are words sent from the prompt box after a pick, and go with it.
 */
type Answer = {
  readonly chosen: readonly string[];
  readonly own: string;
  readonly details?: string;
};

/** What a reload brings back: the answers so far and the question the person was on. */
type Progress = { readonly step: number; readonly answers: readonly Answer[] };

const SavedProgress = type({
  step: "number.integer >= 0",
  answers: type({
    chosen: "string[]",
    own: "string",
    "details?": "string",
  }).array(),
});

// Saved progress fits only the questions it was saved for.
const progressFor =
  (questions: readonly Question[]) =>
  (saved: unknown): Progress | undefined => {
    const result = SavedProgress(saved);
    return !(result instanceof type.errors) &&
      result.answers.length === questions.length &&
      result.step < questions.length
      ? result
      : undefined;
  };

// In the prompt box nothing starts picked: the recommendation shows as a tag, and the person's
// own words in the box answer until they pick.
const startingProgress = (
  questions: readonly Question[],
  place: Place,
): Progress => ({
  step: 0,
  answers: questions.map((question) =>
    place === "box" ? { chosen: [], own: "" } : startingAnswer(question),
  ),
});

/**
 * An open question's answer as the person builds it and sends it, the same for the question card
 * and every screen. What they chose so far is kept for this tab under `key`, so a reload and a
 * switch between the conversation and the page keep it; a stored draft `read` does not accept is
 * dropped before anything draws it. Sending holds from the press until the question settles; a
 * send that failed keeps the draft and says so.
 */
export function useAnswer<Draft>(
  key: string,
  read: (saved: unknown) => Draft | undefined,
  onAnswer: (answer: QuestionAnswer) => Promise<boolean>,
) {
  const [saved, setSaved] = useUnsent(key);
  const parse = useCallback(
    (raw: string): Draft | undefined => {
      if (raw === "") return undefined;
      try {
        return read(JSON.parse(raw));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return undefined;
      }
    },
    [read],
  );
  const draft = useMemo(() => parse(saved), [saved, parse]);
  const unfit = saved !== "" && draft === undefined;
  useEffect(() => {
    if (unfit) setSaved("");
  }, [unfit, setSaved]);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  return {
    /** What the person chose so far; undefined until they choose anything. */
    draft,
    /** Each change starts from what is saved, so two in one tick both land. */
    change: (next: (current: Draft | undefined) => Draft) =>
      setSaved((raw) => JSON.stringify(next(parse(raw)))),
    sending,
    /** Whether the hub took the answer. */
    send: async (answer: QuestionAnswer) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setSending(true);
      try {
        const accepted = await onAnswer(answer);
        if (accepted) setSaved("");
        return accepted;
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    },
  };
}

/** The coordinator marks the option it recommends by ending its label with this. */
const recommendedSuffix = "(Recommended)";

/** The coordinator's recommended answer picked to start with; a question it recommends nothing for starts blank. */
function startingAnswer(question: Question): Answer {
  const recommended = question.options
    .filter((option) => option.label.endsWith(recommendedSuffix))
    .map((option) => option.label);
  const chosen = question.multiple ? recommended : recommended.slice(0, 1);
  return { chosen, own: "" };
}

/** A label as the person's answer reads back: the coordinator's recommendation is not theirs to repeat. */
function shownLabel(label: string): string {
  return label.endsWith(recommendedSuffix)
    ? label.slice(0, -recommendedSuffix.length).trimEnd()
    : label;
}

function answered(answer: Answer): boolean {
  return answer.chosen.length > 0 || answer.own.trim() !== "";
}

/**
 * The options that count. On a pick-one question the person's own words, while there are any,
 * stand in for the option picked; the pick is kept, so clearing the words brings it back.
 */
function chosenOf(question: Question, answer: Answer): readonly string[] {
  return !question.multiple && answer.own.trim() !== "" ? [] : answer.chosen;
}

/** The answer as it is sent: the options that count, then the person's own words, then details. */
export function answerLabels(question: Question, answer: Answer): string[] {
  const chosen = chosenOf(question, answer);
  const labels = question.options
    .filter((option) => chosen.includes(option.label))
    .map((option) => option.label);
  return [labels, answer.own.trim(), answer.details?.trim() ?? ""]
    .flat()
    .filter((label) => label !== "");
}

/**
 * Words sent from the prompt box as this question's answer: details beside a pick, else the
 * person's own answer where the question takes one; undefined where it takes neither.
 */
export function withWords(
  question: Question,
  answer: Answer,
  words: string,
): Answer | undefined {
  if (chosenOf(question, answer).length > 0)
    return { ...answer, details: words };
  if (question.custom || question.options.length === 0)
    return { chosen: [], own: words };
  return undefined;
}

/** Option `index` picked: the only choice on a pick-one question, toggled on a pick-any one. */
function pick(question: Question, answer: Answer, index: number): Answer {
  const value = question.options[index]?.label;
  if (value === undefined) return answer;
  if (!question.multiple) return { chosen: [value], own: "" };
  return {
    ...answer,
    chosen: answer.chosen.includes(value)
      ? answer.chosen.filter((item) => item !== value)
      : [...answer.chosen, value],
  };
}

/**
 * The answer Enter carries on with from an option the person moved to. ↑↓ only move focus, so on a
 * pick-one question Enter takes that option: what the person sees ringed goes forward, not the
 * recommendation.
 * Words the person typed are never swapped for an option focus merely passes over; picking one
 * takes a click, Space or its number.
 */
export function enterAnswer(
  question: Question,
  answer: Answer,
  focused: number,
): Answer {
  if (
    question.multiple ||
    answer.own.trim() !== "" ||
    question.options[focused] === undefined
  )
    return answer;
  return pick(question, answer, focused);
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
 * Enter continues (or sends, on the last question), with the focused option on a pick-one
 * question; → moves on without ever sending; ← goes back;
 * ↑↓ move between the options; Space and 1–9 pick. ← → and digits are left to the own-words field
 * for typing, and Enter to a focused button so Back, Cancel and the answered rows still click.
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

/**
 * The card once done: each question with its answer. What the person wrote back instead of choosing
 * shows in their place, since it reaches the run log, not the conversation.
 */
function Settled({
  ask,
  answer,
  sent,
}: {
  ask: Asked;
  answer: Extract<PromptQuestion, { status: "answered" }>["answer"];
  /** Answered from this card a moment ago. */
  sent: boolean;
}) {
  if ("reply" in answer)
    return <SettledReply reply={answer.reply} sent={sent} />;
  return (
    <SettledFrame title={text.answered} ended="answered" focus={sent}>
      <SettledAnswers
        answers={ask.questions.map((question) => {
          const given = answer.answers[question.id];
          return given !== undefined && given.length > 0
            ? {
                asked: question.question,
                answer: given.map(shownLabel).join(", "),
              }
            : {
                asked: question.question,
                answer: text.notAnswered,
                absent: true,
              };
        })}
      />
    </SettledFrame>
  );
}

/** Any question once the person wrote back instead of answering it, a plugin's screen included. */
export function SettledReply({
  reply,
  sent,
}: {
  reply: string;
  /** Answered from this card a moment ago. */
  sent: boolean;
}) {
  return (
    <SettledFrame title={text.answeredInChat} ended="answered" focus={sent}>
      <p className={styles.reply}>{reply}</p>
    </SettledFrame>
  );
}

/**
 * Any question once its coordinator stopped unanswered, a plugin's screen included: what it asked,
 * which no answer reaches now.
 */
export function ClosedQuestions({ asks }: { asks: readonly string[] }) {
  return (
    <SettledFrame title={text.closed(asks.length)} ended="closed">
      <SettledAnswers
        answers={asks.map((asked) => ({
          asked,
          answer: text.notAnswered,
          absent: true,
        }))}
      />
    </SettledFrame>
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
  onOpen,
}: {
  question: Question;
  answer: Answer;
  onOpen: () => void;
}) {
  const labels = answerLabels(question, answer).map(shownLabel).join(", ");
  return (
    <li className={styles.row}>
      <ThreadMark mark="done" />
      <button
        type="button"
        className={styles.answered}
        aria-label={text.changeAnswer(question.question, labels)}
        onClick={onOpen}
      >
        <span className={styles.answeredPrompt}>{question.question}</span>
        <span className={styles.answeredValue}>{labels}</span>
        <Pencil className={styles.answeredEdit} aria-hidden />
      </button>
    </li>
  );
}

/**
 * An option's label, with the line that explains it where the coordinator wrote one. In the prompt
 * box the coordinator's recommendation is a tag beside the label rather than part of it.
 */
function OptionText({
  label,
  description,
  boxed,
}: Question["options"][number] & { boxed: boolean }) {
  return (
    <span className={styles.choiceText}>
      {boxed ? (
        <span className={styles.choiceLabel}>
          {shownLabel(label)}
          {label.endsWith(recommendedSuffix) ? (
            <span className={styles.recommended}>{text.recommended}</span>
          ) : null}
        </span>
      ) : (
        label
      )}
      {description === "" ? null : (
        <span className={styles.choiceDescription}>{description}</span>
      )}
    </span>
  );
}

function Choices({
  name,
  question,
  answer,
  ruleId,
  onPick,
  onOwn,
  boxed,
}: {
  name: string;
  question: Question;
  answer: Answer;
  ruleId: string;
  onPick: (index: number) => void;
  onOwn: (own: string) => void;
  /** In the prompt box, whose own words answer instead of a field in the card. */
  boxed: boolean;
}) {
  const multi = question.multiple;
  const typed = question.options.length === 0;
  const chosen = chosenOf(question, answer);
  const picked = chosen.length;
  return (
    <fieldset
      className={styles.question}
      aria-describedby={typed ? undefined : ruleId}
    >
      <legend className={styles.prompt}>{question.question}</legend>
      {typed ? null : (
        <p id={ruleId} className={styles.rule}>
          {multi ? text.pickAny : text.pickOne}
          {multi && picked > 0 ? (
            <span className={styles.ruleCount}>
              {text.selected(picked, question.options.length)}
            </span>
          ) : null}
        </p>
      )}
      <div className={styles.choices} data-kind={multi ? "multi" : "single"}>
        {question.options.map((option, index) => {
          const checked = chosen.includes(option.label);
          if (multi)
            return (
              <label
                key={option.label}
                className={styles.choice}
                data-checked={checked ? "" : undefined}
                // Safari leaves focus where it was on a click; the card's keys need it here.
                onClick={(event) =>
                  event.currentTarget.querySelector("input")?.focus()
                }
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onPick(index)}
                  className={styles.check}
                />
                <OptionText {...option} boxed={boxed} />
              </label>
            );
          return (
            <label
              key={option.label}
              className={styles.choice}
              data-checked={checked ? "" : undefined}
            >
              <input
                type="radio"
                name={name}
                checked={checked}
                aria-keyshortcuts={String(index + 1)}
                onChange={() => onPick(index)}
                onClick={(event) => {
                  // Safari leaves focus where it was on a click; the card's keys need it here.
                  event.currentTarget.focus();
                  // A checked radio fires no change, so a click on the recommended answer moves on here.
                  if (checked) onPick(index);
                }}
              />
              {boxed ? null : (
                <span className={styles.box} aria-hidden>
                  {checked ? <Check /> : index + 1}
                </span>
              )}
              <OptionText {...option} boxed={boxed} />
            </label>
          );
        })}
        {/* In the prompt box the person's own words go in the box, unless there is nothing to pick. */}
        {question.custom && !(boxed && !typed) ? (
          <label
            className={styles.choice}
            data-checked={answer.own.trim() === "" ? undefined : ""}
          >
            {typed ? null : (
              <span className={styles.box} aria-hidden>
                <Plus />
              </span>
            )}
            <input
              type="text"
              className={styles.own}
              aria-label={text.otherAnswer}
              placeholder={typed ? text.typed : text.other}
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

function OpenCard({
  id,
  ask,
  blocked,
  sending,
  fault,
  onSend,
  step,
  answers,
  onStep,
  onAnswer,
  focusFollows,
  onFocusFollows,
  place,
}: {
  id: string;
  ask: Asked;
  /** Closed to answers for now, such as while another message is sending. */
  blocked: boolean;
  sending: boolean;
  /** The last answer did not reach the hub. */
  fault: string | undefined;
  onSend: (answer: QuestionAnswer) => void;
  step: number;
  answers: readonly Answer[];
  onStep: (to: number) => void;
  onAnswer: (at: number, answer: Answer) => void;
  /**
   * The card takes focus only once the person has stepped or sent, never as it appears, so keys
   * meant for the composer stay there; from then on focus follows the open question.
   */
  focusFollows: boolean;
  onFocusFollows: () => void;
  place: Place;
}) {
  const { questions } = ask;
  const boxed = place === "box";
  const slot = useContext(ActionsSlot);
  const [earlierShown, setEarlierShown] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  /** The option the person last moved to with ↑↓, which Enter may carry forward. */
  const aimed = useRef<HTMLInputElement>(null);

  const question = questions[step];
  const picked =
    question === undefined
      ? []
      : chosenOf(question, answers[step] ?? { chosen: [], own: "" });
  usePromptPlaceholder(
    picked.length === 0
      ? undefined
      : text.addDetails(picked.map(shownLabel).join(", ")),
  );
  usePromptSend(
    boxed && question !== undefined && !blocked && !sending
      ? (words) => takeWords(words)
      : undefined,
  );
  useEffect(() => {
    // While the card is inert its options take no focus; this runs again once it opens.
    if (
      !focusFollows ||
      blocked ||
      sending ||
      card.current === null ||
      choices.current === null
    )
      return;
    // Focus comes from inside the card, or from nowhere once a send settled it and failed; never
    // from wherever the person has moved on to meanwhile.
    const active = document.activeElement;
    const free = active === null || active === document.body;
    if (!free && !card.current.contains(active)) return;
    // Onto the answer as it stands: the option picked, else the person's own words, else the first.
    const inputs = [...choices.current.querySelectorAll("input")];
    const target =
      inputs.find((input) => input.checked) ??
      inputs.find(
        (input) => input.type === "text" && input.value.trim() !== "",
      ) ??
      inputs[0];
    target?.focus();
  }, [step, focusFollows, blocked, sending]);
  if (question === undefined) return null;

  const answerOf = (index: number): Answer =>
    answers[index] ?? { chosen: [], own: "" };
  const answer = answerOf(step);
  const last = step === questions.length - 1;
  const ready = answered(answer);
  const disabled = blocked || sending;
  const setAnswer = (next: Answer) => onAnswer(step, next);
  const go = (to: number) => {
    onStep(Math.max(0, Math.min(to, questions.length - 1)));
    onFocusFollows();
  };
  const deliver = (answer: QuestionAnswer) => {
    onFocusFollows();
    onSend(answer);
  };
  const send = (current: Answer) =>
    deliver({
      answers: Object.fromEntries(
        questions.map((item, index) => [
          item.id,
          answerLabels(item, index === step ? current : answerOf(index)),
        ]),
      ),
    });
  /** On to the next question with `current` as this one's answer, or send on the last. */
  const next = (current: Answer) => {
    if (disabled || !answered(current)) return;
    if (current !== answer) setAnswer(current);
    if (last) send(current);
    else go(step + 1);
  };
  // Send in the prompt box carries what it holds with the pick, then moves on as Continue does.
  function takeWords(words: string): boolean {
    if (question === undefined) return false;
    const current = withWords(question, answer, words);
    if (current === undefined) return false;
    next(current);
    return true;
  }
  // A pick-one question moves on once picked, except the last: only the person sends. In the prompt
  // box a pick only selects, so the person can add details before Continue.
  const choose = (index: number) => {
    if (question.options[index] === undefined) return;
    setAnswer(pick(question, answer, index));
    if (!boxed && !question.multiple && !last) go(step + 1);
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
        // Only an option the person moved to with ↑↓ goes forward. Where the card put focus itself,
        // such as the first option after a click, nothing marks it, so Enter keeps the answer as is.
        return next(
          event.target === aimed.current
            ? enterAnswer(question, answer, at)
            : answer,
        );
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
        const target =
          inputs[Math.max(0, Math.min(from + intent.by, inputs.length - 1))];
        if (target === undefined) return;
        aimed.current = target;
        return target.focus();
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
        onOpen={() => go(index)}
      />
    );
  };

  const current = (
    <div ref={choices}>
      <Choices
        key={question.id}
        name={`${id}-${question.id}`}
        question={question}
        answer={answer}
        ruleId={ruleId}
        onPick={choose}
        onOwn={(own) => setAnswer({ ...answer, own })}
        boxed={boxed}
      />
    </div>
  );

  const buttons = (
    <>
      {step === 0 ? null : (
        <Tooltip label={text.backKeys}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={styles.back}
            aria-keyshortcuts="ArrowLeft"
            onClick={() => go(step - 1)}
          >
            <ChevronLeft aria-hidden />
            {text.back}
          </Button>
        </Tooltip>
      )}
      {/* Cancel and Continue keep the end of the row, so neither moves as Back comes and goes. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={styles.cancel}
        onClick={() => deliver({ reply: text.cancelReply })}
      >
        {text.cancel}
      </Button>
      <Tooltip label={last ? text.sendKeys : text.nextKeys}>
        <Button
          type="button"
          size="sm"
          className={styles.next}
          aria-disabled={!ready}
          aria-describedby={question.options.length === 0 ? undefined : ruleId}
          aria-keyshortcuts={last ? "Enter" : "Enter ArrowRight"}
          onClick={() => next(answer)}
        >
          {nextLabel(last, sending)}
          <CornerDownLeft aria-hidden />
        </Button>
      </Tooltip>
    </>
  );

  // In the prompt box the open question heads the card, with Back and where it stands beside it;
  // Continue stands where Send does only once something is picked, else the box's own Send.
  if (boxed)
    return (
      <section
        ref={card}
        className={styles.inBox}
        aria-label={question.question}
        onKeyDown={onKeyDown}
        inert={disabled}
        data-place="box"
      >
        <header className={styles.boxHeader}>
          <h3 className={styles.boxQuestion}>{question.question}</h3>
          {questions.length > 1 ? (
            <div className={styles.step}>
              {step === 0 ? null : (
                <Tooltip label={text.backKeys}>
                  <button
                    type="button"
                    className={styles.stepBack}
                    aria-label={text.back}
                    aria-keyshortcuts="ArrowLeft"
                    onClick={() => go(step - 1)}
                  >
                    <ChevronLeft aria-hidden />
                  </button>
                </Tooltip>
              )}
              <p aria-live="polite">
                {text.position(step + 1, questions.length)}
              </p>
            </div>
          ) : null}
        </header>
        <div className={styles.thread}>{current}</div>
        {fault !== undefined ? (
          <div className={styles.fault}>
            <Fault>{fault}</Fault>
          </div>
        ) : null}
        {slot?.(
          ready ? (
            <div className={styles.hosted} inert={disabled}>
              <Tooltip label={last ? text.sendKeys : text.nextKeys}>
                <Button
                  type="button"
                  size="sm"
                  aria-keyshortcuts={last ? "Enter" : "Enter ArrowRight"}
                  onClick={() => next(answer)}
                >
                  {nextLabel(last, sending)}
                </Button>
              </Tooltip>
            </div>
          ) : null,
        )}
      </section>
    );

  return (
    <GateBlock
      className={styles.card}
      gate={{ kind: "form", title: text.title(questions.length) }}
    >
      {/* Keys act anywhere in the card, from the options to the buttons, and nowhere else. While
          an answer is on its way, or answers are closed for now, the whole card takes no input. */}
      <div ref={card} onKeyDown={onKeyDown} inert={disabled}>
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
            {/* A lone question has no steps to mark; the empty cell keeps the column. */}
            {questions.length > 1 ? <ThreadMark mark="current" /> : <span />}
            {current}
          </li>
          {upcoming === undefined ? null : (
            <li className={styles.row} data-upcoming="">
              <ThreadMark mark="upcoming" />
              <span className={styles.upcoming}>
                {upcoming.question}
                {more > 0 ? <span>{text.more(more)}</span> : null}
              </span>
            </li>
          )}
        </ol>
        {fault !== undefined ? (
          <div className={styles.fault}>
            <Fault>{fault}</Fault>
          </div>
        ) : null}
        <div className={styles.footer}>
          {/* Drawn where the host puts them, such as in the prompt box where Send stands; there
              they are outside the card's inert hold, so they take it again. */}
          {slot === null
            ? buttons
            : slot(
                <div className={styles.hosted} inert={disabled}>
                  {buttons}
                </div>,
              )}
        </div>
      </div>
    </GateBlock>
  );
}

/** In the conversation, or inside the prompt box above the words. */
type Place = "conversation" | "box";

export function QuestionsCard({
  question,
  disabled,
  onAnswer,
  place = "conversation",
}: {
  question: PromptQuestion;
  /** Closed to answers for now, such as while another message is sending. */
  disabled: boolean;
  /** Sends each question's answer under its id, or Cancel's reply; whether the hub took it. */
  onAnswer: (answer: QuestionAnswer) => Promise<boolean>;
  place?: Place;
}) {
  const { signalName, asked } = question;
  const outcome = useQuestionOutcome(signalName);
  const readProgress = useMemo(
    () => progressFor(asked.questions),
    [asked.questions],
  );
  const { draft, change, sending, send } = useAnswer(
    `unsent:questions:${signalName}`,
    readProgress,
    onAnswer,
  );
  const progress = draft ?? startingProgress(asked.questions, place);
  const update = (next: (current: Progress) => Progress) =>
    change((current) =>
      next(current ?? startingProgress(asked.questions, place)),
    );
  // Held above the open card, so a failed send reopens it with focus where it was.
  const [focusFollows, setFocusFollows] = useState(false);
  switch (question.status) {
    case "open":
      return (
        <OpenCard
          id={signalName}
          ask={asked}
          blocked={disabled}
          sending={sending || outcome?.kind === "sending"}
          fault={
            outcome !== undefined && "fault" in outcome
              ? outcome.fault
              : undefined
          }
          onSend={(answer) => void send(answer)}
          step={progress.step}
          answers={progress.answers}
          onStep={(to) =>
            update((current) => ({ step: to, answers: current.answers }))
          }
          onAnswer={(at, answer) =>
            update((current) => ({
              step: current.step,
              answers: current.answers.map((item, index) =>
                index === at ? answer : item,
              ),
            }))
          }
          focusFollows={focusFollows}
          onFocusFollows={() => setFocusFollows(true)}
          place={place}
        />
      );
    case "answered":
      return (
        <Settled ask={asked} answer={question.answer} sent={focusFollows} />
      );
    case "closed":
      return (
        <ClosedQuestions
          asks={asked.questions.map(({ question: ask }) => ask)}
        />
      );
    default:
      return question satisfies never;
  }
}
