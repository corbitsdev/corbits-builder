import { useQuestionOutcome } from "./question-outcome.tsx";
/**
 * The coordinator's open question as a card in the prompt box, answered one question at a time; once
 * settled, it reads back in the conversation. The run log holds the question and, once sent, the
 * answer, so the card reads the same after a reload.
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
import { Check, ChevronLeft, MessageCircleQuestionMark } from "lucide-react";
import { Button } from "@corbits/react-ui";
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
  GivenQuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { type } from "arktype";
import { useUnsent } from "../../../unsent.ts";
import { wording } from "../../../config.ts";
import { Fault, KeyHint } from "../../../components.jsx";
import styles from "./questions-card.module.css";

const text = wording.questions;

type Asked = PromptQuestion["asked"];
type Question = Asked["questions"][number];

/**
 * The options picked, by label, plus the person's own words, which answer a question with nothing
 * to pick. Details are words sent from the prompt box after a pick, and go with it.
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

// Nothing starts picked: the recommendation shows as a tag, and words sent from the box are a
// reply until the person picks.
const startingProgress = (questions: readonly Question[]): Progress => ({
  step: 0,
  answers: questions.map(() => ({ chosen: [], own: "" })),
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
  onAnswer: (answer: GivenQuestionAnswer) => Promise<boolean>,
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
    send: async (answer: GivenQuestionAnswer) => {
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

/**
 * The coordinator marks the option it recommends by ending its label with "(Recommended)". A model
 * does not always write it exactly so, so its case and the spaces around it do not matter.
 */
const recommendedMark = /\s*\(recommended\)\s*$/i;

export const isRecommended = (label: string) => recommendedMark.test(label);

/** A label as the person's answer reads back: the coordinator's recommendation is not theirs to repeat. */
export function shownLabel(label: string): string {
  return label.replace(recommendedMark, "");
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

/** The answer as it is sent: the options that count, then the person's own words. */
export function answerLabels(question: Question, answer: Answer): string[] {
  const chosen = chosenOf(question, answer);
  const labels = question.options
    .filter((option) => chosen.includes(option.label))
    .map((option) => option.label);
  const own = answer.own.trim();
  return own === "" ? labels : [...labels, own];
}

/** The whole card as it is sent: each question's answer, and the details given beside any. */
export function sentAnswer(
  card: readonly { question: Question; answer: Answer }[],
): GivenQuestionAnswer {
  const sent = {
    answers: Object.fromEntries(
      card.map(({ question, answer }) => [
        question.id,
        answerLabels(question, answer),
      ]),
    ),
  };
  const details = card.flatMap(({ question, answer }) => {
    const words = answer.details?.trim();
    return words === undefined || words === ""
      ? []
      : [[question.id, words] as const];
  });
  return details.length === 0
    ? sent
    : { answers: sent.answers, details: Object.fromEntries(details) };
}

/**
 * Words sent from the prompt box as this question's answer: details beside a pick, or the answer
 * itself where there is nothing to pick. Undefined leaves them to the conversation as a reply, so
 * a person can write back to the coordinator before answering.
 */
export function withWords(
  question: Question,
  answer: Answer,
  words: string,
): Answer | undefined {
  if (chosenOf(question, answer).length > 0)
    return { ...answer, details: words };
  if (question.options.length === 0) return { chosen: [], own: words };
  return undefined;
}

/** What the prompt box asks for under the open question; undefined leaves the box's own line. */
function boxPlaceholder(
  question: Question,
  picked: readonly string[],
): string | undefined {
  if (question.options.length === 0) return text.typed;
  if (picked.length > 0)
    return text.addDetails(picked.map(shownLabel).join(", "));
  return undefined;
}

/**
 * Option `index` picked: the only choice on a pick-one question, toggled on a pick-any one.
 * Picking a pick-one question's choice again takes it back, so the box answers in words again.
 */
function pick(question: Question, answer: Answer, index: number): Answer {
  const value = question.options[index]?.label;
  if (value === undefined) return answer;
  if (!question.multiple)
    return {
      chosen: chosenOf(question, answer).includes(value) ? [] : [value],
      own: "",
    };
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
  const aimed = question.options[focused]?.label;
  // Enter on the option already picked goes on with it; only a click or its key takes it back.
  if (
    question.multiple ||
    answer.own.trim() !== "" ||
    aimed === undefined ||
    answer.chosen.includes(aimed)
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
 * for typing, and Enter to a focused button so Back and Continue still click.
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
    <SettledFrame title={text.answered} untitled ended="answered" focus={sent}>
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

/**
 * An option's label, with the line that explains it where the coordinator wrote one. The
 * coordinator's recommendation is a tag beside the label rather than part of it.
 */
function OptionText({ label, description }: Question["options"][number]) {
  return (
    <span className={styles.choiceText}>
      <span className={styles.choiceLabel}>
        {shownLabel(label)}
        {isRecommended(label) ? (
          <span className={styles.recommended}>{text.recommended}</span>
        ) : null}
      </span>
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
}: {
  name: string;
  question: Question;
  answer: Answer;
  ruleId: string;
  onPick: (index: number) => void;
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
      <div className={styles.choices}>
        {question.options.map((option, index) => {
          const checked = chosen.includes(option.label);
          // A pick-any row leads with a box that takes a tick, a pick-one row with a round radio,
          // so how many may be chosen is plain before anything is.
          return (
            <label
              key={option.label}
              className={styles.choice}
              data-checked={checked ? "" : undefined}
            >
              <span className={styles.mark}>
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={multi ? undefined : name}
                  checked={checked}
                  aria-keyshortcuts={String(index + 1)}
                  onChange={() => onPick(index)}
                  onClick={(event) => {
                    // Safari leaves focus where it was on a click; the card's keys need it here.
                    event.currentTarget.focus();
                    // A checked radio fires no change, so a click on it reaches the pick here.
                    if (!multi && checked) onPick(index);
                  }}
                />
                {multi ? <Check aria-hidden="true" /> : null}
              </span>
              <OptionText {...option} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
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
}: {
  id: string;
  ask: Asked;
  /** Closed to answers for now, such as while another message is sending. */
  blocked: boolean;
  sending: boolean;
  /** The last answer did not reach the hub. */
  fault: string | undefined;
  onSend: (answer: GivenQuestionAnswer) => void;
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
}) {
  const { questions } = ask;
  const slot = useContext(ActionsSlot);
  const card = useRef<HTMLElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  /** The option the person last moved to with ↑↓, which Enter may carry forward. */
  const aimed = useRef<HTMLInputElement>(null);

  const question = questions[step];
  const picked =
    question === undefined
      ? []
      : chosenOf(question, answers[step] ?? { chosen: [], own: "" });
  // The person's own words go in the prompt box, the one place to type, even where there is
  // nothing to pick: then the box asks for the answer itself.
  usePromptPlaceholder(
    question === undefined ? undefined : boxPlaceholder(question, picked),
  );
  usePromptSend(
    question !== undefined && !blocked && !sending
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
  const deliver = (answer: GivenQuestionAnswer) => {
    onFocusFollows();
    onSend(answer);
  };
  const send = (current: Answer) =>
    deliver(
      sentAnswer(
        questions.map((item, index) => ({
          question: item,
          answer: index === step ? current : answerOf(index),
        })),
      ),
    );
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
    // Enter on an empty box goes forward as Continue does, with the details already given.
    const current = words === "" ? answer : withWords(question, answer, words);
    if (current === undefined) return false;
    next(current);
    return true;
  }
  // A pick only selects, so the person can add details in the box before Continue.
  const choose = (index: number) => {
    if (question.options[index] === undefined) return;
    setAnswer(pick(question, answer, index));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
        return choose(at);
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

  // The open question heads the card, with Back and where it stands beside it; Continue
  // stands where Send does only once something is picked, else the box's own Send. It reads
  // Continue on the last question too: the box is one step of a flow, and its tooltip says that
  // this step sends.
  return (
    <section
      ref={card}
      className={styles.inBox}
      aria-label={question.question}
      onKeyDown={onKeyDown}
      inert={disabled}
      data-place="box"
    >
      {/* What the question is about and how far through them the person is, then the question
          itself as the card's heading. The bar's segments say where it stands; a screen reader
          hears it as words. */}
      <header className={styles.boxHeader}>
        <p className={styles.topic}>
          <MessageCircleQuestionMark aria-hidden="true" />
          {question.header}
        </p>
        {questions.length > 1 ? (
          <div className={styles.step}>
            {step === 0 ? null : (
              <Tooltip label={<KeyHint {...text.backKeys} />}>
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
            <ol className={styles.progress} aria-hidden="true">
              {questions.map((item, index) => (
                <li
                  key={item.id}
                  data-state={
                    index < step ? "done" : index === step ? "open" : "ahead"
                  }
                />
              ))}
            </ol>
            <p className={styles.said} aria-live="polite">
              {text.position(step + 1, questions.length)}
            </p>
          </div>
        ) : null}
      </header>
      <h3 className={styles.boxQuestion}>{question.question}</h3>
      <div ref={choices} className={styles.thread}>
        <Choices
          key={question.id}
          name={`${id}-${question.id}`}
          question={question}
          answer={answer}
          ruleId={`${id}-${question.id}-rule`}
          onPick={choose}
        />
      </div>
      {fault !== undefined ? (
        <div className={styles.fault}>
          <Fault>{fault}</Fault>
        </div>
      ) : null}
      {slot?.(
        ready ? (
          <div className={styles.hosted} inert={disabled}>
            <Tooltip
              label={<KeyHint {...(last ? text.sendKeys : text.nextKeys)} />}
            >
              <Button
                type="button"
                size="sm"
                aria-keyshortcuts={last ? "Enter" : "Enter ArrowRight"}
                onClick={() => next(answer)}
              >
                {sending ? text.sending : text.next}
              </Button>
            </Tooltip>
          </div>
        ) : null,
      )}
    </section>
  );
}

export function QuestionsCard({
  question,
  disabled,
  onAnswer,
}: {
  question: PromptQuestion;
  /** Closed to answers for now, such as while another message is sending. */
  disabled: boolean;
  /** Sends each question's answer under its id; whether the hub took it. */
  onAnswer: (answer: GivenQuestionAnswer) => Promise<boolean>;
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
  const progress = draft ?? startingProgress(asked.questions);
  const update = (next: (current: Progress) => Progress) =>
    change((current) => next(current ?? startingProgress(asked.questions)));
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
