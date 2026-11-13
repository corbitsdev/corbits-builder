/**
 * The coordinator's open question as a card the person answers one question at a time. The run log
 * holds the question and, once sent, the answer, so the card reads the same after a reload and
 * settles when the answer lands.
 */
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
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
import { Button, Checkbox, GateBlock, Input } from "@corbits/react-ui";
import { Tooltip } from "@corbits/react-ui/ui/tooltip";
import type { AskedQuestion } from "@intx/types/runtime-core";
import type { QuestionAnswer } from "@intx/types/signals";
import { type } from "arktype";
import {
  ScreenActions,
  ScreenCancel,
} from "@corbits-builder/plugin-ui/screen-actions";
import { wording } from "../../config.ts";
import { Fault } from "../../components.jsx";
import { readJson } from "../../json.ts";
import styles from "./questions-card.module.css";

const text = wording.questions;

/** A question asked as prompts, as opposed to a plugin's screen. */
export type PromptsQuestion = Exclude<AskedQuestion, { plugin: string }>;

type Question = PromptsQuestion["questions"][number];

export type QuestionsState =
  | {
      readonly kind: "open";
      readonly disabled: boolean;
      /** Sends each question's answer under its id. */
      readonly onSend: (answers: Record<string, string[]>) => Promise<boolean>;
      /** Closes the question without choosing, as a typed reply would. */
      readonly onCancel: () => Promise<boolean>;
    }
  | { readonly kind: "answered"; readonly answer: QuestionAnswer };

/** The options picked, by label, plus the person's own words; typing those is the "Something else" answer. */
type Answer = { readonly chosen: readonly string[]; readonly own: string };

const blank: Answer = { chosen: [], own: "" };

// Picks made before sending survive a reload of this tab, and are dropped once the answer is sent.
const KeptAnswers = type({ "[string]": { chosen: "string[]", own: "string" } });
const draftKey = (id: string) => `question-draft:${id}`;

function readKept(id: string): Record<string, Answer> {
  try {
    const raw = sessionStorage.getItem(draftKey(id));
    return (raw === null ? null : readJson(raw, KeptAnswers)) ?? {};
  } catch (error) {
    console.warn(
      "Browser storage is unavailable; picks last until a reload.",
      error,
    );
    return {};
  }
}

function writeKept(id: string, answers: Record<string, Answer> | null): void {
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

/** The coordinator marks the option it recommends by ending its label with this. */
const recommendedSuffix = "(Recommended)";

/**
 * The recommended answer picked to start with, the first such option on a pick-one question; a
 * question it recommends nothing for starts blank.
 */
function startingAnswer(question: Question): Answer {
  const recommended = question.options
    .filter((option) => option.label.endsWith(recommendedSuffix))
    .map((option) => option.label);
  const chosen = question.multiple ? recommended : recommended.slice(0, 1);
  return { chosen, own: "" };
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
 * pick-one question Enter takes that option: what the person sees ringed goes forward.
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

/** The card once answered: each question with its answer, or what the person wrote instead. */
function Settled({
  asked,
  answer,
}: {
  asked: PromptsQuestion;
  answer: QuestionAnswer;
}) {
  if ("reply" in answer) return <SettledReply reply={answer.reply} />;
  if (!("answers" in answer))
    throw new Error(
      "A question asked as prompts was answered with a screen's output.",
    );
  return (
    <SettledBox
      title={text.answered}
      mark={<Check className={styles.settledMark} data-ok="" aria-hidden />}
    >
      <dl className={styles.answers}>
        {asked.questions.map((question) => (
          <div key={question.id}>
            <dt>{question.question}</dt>
            <dd>{(answer.answers[question.id] ?? []).join(", ")}</dd>
          </div>
        ))}
      </dl>
    </SettledBox>
  );
}

/** Any open question once the person wrote back instead of answering it: what they wrote. */
export function SettledReply({ reply }: { reply: string }) {
  return (
    <SettledBox
      title={text.answeredInWords}
      mark={<CornerDownRight className={styles.settledMark} aria-hidden />}
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
  children: ReactNode;
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

/** An option's label, with the line that explains it where the coordinator wrote one. */
function OptionText({ label, description }: Question["options"][number]) {
  return (
    <span className={styles.choiceText}>
      {label}
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
  // A question with no options is answered in the person's own words.
  if (question.options.length === 0)
    return (
      <fieldset className={styles.question} disabled={disabled}>
        <legend className={styles.prompt}>{question.question}</legend>
        <Input
          id={name}
          aria-label={question.question}
          value={answer.own}
          onChange={(event) => onOwn(event.target.value)}
        />
      </fieldset>
    );
  const multi = question.multiple;
  const chosen = chosenOf(question, answer);
  const picked = chosen.length;
  return (
    <fieldset
      className={styles.question}
      disabled={disabled}
      aria-describedby={ruleId}
    >
      <legend className={styles.prompt}>{question.question}</legend>
      <p id={ruleId} className={styles.rule}>
        {multi ? text.pickAny : text.pickOne}
        {multi && picked > 0 ? (
          <span className={styles.ruleCount}>
            {text.selected(picked, question.options.length)}
          </span>
        ) : null}
      </p>
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
                <OptionText {...option} />
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
                  // A checked radio fires no change, so a click on the picked answer moves on here.
                  if (checked) onPick(index);
                }}
              />
              <span className={styles.box} aria-hidden>
                {checked ? <Check /> : index + 1}
              </span>
              <OptionText {...option} />
            </label>
          );
        })}
        {question.custom ? (
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
  asked,
  blocked,
  onSend,
  onCancel,
  draft,
  onDraft,
}: {
  id: string;
  asked: PromptsQuestion;
  /** Closed to answers for now, such as while another message is sending. */
  blocked: boolean;
  onSend: (answers: Record<string, string[]>) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  draft: Draft;
  onDraft: Dispatch<SetStateAction<Draft>>;
}) {
  const { questions } = asked;
  const { answers, step, failed, focusFollows } = draft;
  const [earlierShown, setEarlierShown] = useState(false);
  const [sending, setSending] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  /** The option the person last moved to with ↑↓, which Enter may carry forward. */
  const aimed = useRef<HTMLInputElement>(null);

  const question = questions[step];
  useEffect(() => {
    // While blocked the options are disabled and take no focus; this runs again once they open.
    if (
      !focusFollows ||
      blocked ||
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
  }, [step, focusFollows, blocked]);
  if (question === undefined) return null;

  const answerOf = (index: number): Answer => answers[index] ?? blank;
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
  const deliver = async (sent: () => Promise<boolean>) => {
    setSending(true);
    onDraft((current) => ({ ...current, failed: false, focusFollows: true }));
    // Once sent, the card stays sending until the room shows the answer and it settles.
    if (await sent()) return;
    setSending(false);
    onDraft((current) => ({ ...current, failed: true }));
  };
  const send = (current: Answer) =>
    deliver(() =>
      onSend(
        Object.fromEntries(
          questions.map((item, index) => [
            item.id,
            answerLabels(item, index === step ? current : answerOf(index)),
          ]),
        ),
      ),
    );
  /** On to the next question with `current` as this one's answer, or send on the last. */
  const next = (current: Answer) => {
    if (disabled || !answered(current)) return;
    if (current !== answer) setAnswer(current);
    if (last) void send(current);
    else go(step + 1);
  };
  // A pick-one question moves on once picked, except the last: only the person sends.
  const choose = (index: number) => {
    if (question.options[index] === undefined) return;
    setAnswer(pick(question, answer, index));
    if (!question.multiple && !last) go(step + 1);
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
      <div ref={card} onKeyDown={onKeyDown}>
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
                onOwn={(own) => setAnswer({ ...answer, own })}
              />
            </div>
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
        <div className={styles.footer}>
          <ScreenCancel
            value={{
              label: text.cancel,
              disabled,
              onCancel: () => void deliver(onCancel),
            }}
          >
            <ScreenActions>
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
                  type="button"
                  size="sm"
                  className={styles.next}
                  aria-disabled={disabled || !ready}
                  aria-describedby={
                    question.options.length === 0 ? undefined : ruleId
                  }
                  aria-keyshortcuts={last ? "Enter" : "Enter ArrowRight"}
                  onClick={() => next(answer)}
                >
                  {nextLabel(last, sending)}
                  <CornerDownLeft aria-hidden />
                </Button>
              </Tooltip>
            </ScreenActions>
          </ScreenCancel>
        </div>
      </div>
    </GateBlock>
  );
}

/** The answers kept from before a reload; the first question still unanswered opens. */
function startingDraft(id: string, asked: PromptsQuestion): Draft {
  const kept = readKept(id);
  const answers = asked.questions.map(
    (question) => kept[question.id] ?? startingAnswer(question),
  );
  // A recommendation is only a starting point, so it does not count as the person's answer here.
  const unanswered = asked.questions.findIndex(
    (question) => !answered(kept[question.id] ?? blank),
  );
  return {
    answers,
    step: unanswered < 0 ? answers.length - 1 : unanswered,
    failed: false,
    focusFollows: false,
  };
}

export function QuestionsCard({
  id,
  asked,
  state,
}: {
  /** The question's signal, so each card's field ids are its own. */
  id: string;
  asked: PromptsQuestion;
  state: QuestionsState;
}) {
  // Held above the open card, so a failed send reopens it as it was.
  const [draft, setDraft] = useState(() => startingDraft(id, asked));
  const settled = state.kind === "answered";
  const { questions } = asked;
  useEffect(() => {
    if (settled) writeKept(id, null);
    else if (draft.answers.some(answered))
      writeKept(
        id,
        Object.fromEntries(
          questions.map((question, index) => [
            question.id,
            draft.answers[index] ?? blank,
          ]),
        ),
      );
  }, [id, questions, draft.answers, settled]);
  if (state.kind === "answered")
    return <Settled asked={asked} answer={state.answer} />;
  return (
    <OpenCard
      id={id}
      asked={asked}
      blocked={state.disabled}
      onSend={state.onSend}
      onCancel={state.onCancel}
      draft={draft}
      onDraft={setDraft}
    />
  );
}
