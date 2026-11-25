import { QuestionEntry } from "./question-outcome.tsx";
/**
 * Committed person and assistant turns, drawn through the vendored
 * MessageParts path. The body is the human-readable turn: questions,
 * decisions, documents, and plain failures. Tool names, ids, hashes, and
 * status payloads stay on the turn data and out of the transcript. What still
 * waits on the person, an open question or an undecided approval, is the
 * prompt box's; the thread keeps only how each settled. This view does not
 * invent a coordinator turn.
 */
import {
  ACTIVITY_SHOWN,
  IMPORTED_PROJECT_LEAD,
  wording,
  type ActivityShown,
} from "../../config.ts";
import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import {
  Activity,
  ActivityContent,
  ActivityTrigger,
  Conversation,
  ConversationContent,
  ConversationDivider,
  ConversationItem,
  ConversationNotice,
  ConversationScrollButton,
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageFold,
  MessageFooter,
  MessageHeader,
  MessageParts,
  MessageSendStatus,
  ShimmerText,
  Tool,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ActivityStep,
  type ConversationPart,
  type PartText,
  type PartTool,
  type ToolApprovalStatus,
} from "@corbits/react-ui";
import { commandLine, readStep, type Step } from "./agent-activity.tsx";
import { DOCUMENT_LINK, Markdown } from "@corbits-builder/plugin-ui/markdown";
import { toast } from "sonner";
import styles from "./transcript.module.css";
import { proseSegments, type NamedDocument } from "./collaboration.ts";
import { DocumentDecision, PackageDecision } from "./document-decision.tsx";
import { turnLabel, visibleTurnParts } from "./visible-chat.ts";
import {
  distinctUpdates,
  groupUpdates,
  specialistUpdate,
  updatesRow,
  updateSubject,
  type SpecialistUpdate,
  type UpdateGroup,
} from "./specialist-updates.ts";
import {
  FoldedUpdatesView,
  SpecialistUpdatesView,
} from "./specialist-updates.view.tsx";
import { partsDispatches, type Dispatch } from "./dispatch-card.tsx";
import { workUnits, type WorkUnit } from "./work-unit.ts";
import {
  inProgress,
  WorkInProgress,
  WorkUnitStepView,
  type WorkUnitStanding,
} from "./work-unit-step.view.tsx";
import type { CallResult } from "./live-run.ts";
import { ClosedQuestions, QuestionsCard } from "./questions-card.tsx";
import {
  ScreenQuestion,
  type HostSupplies,
  type ProjectValuesStore,
} from "./screen-question.tsx";
import { namesScreen, type ScreenLookup } from "./screens.ts";
import {
  HUB_NOTE_LEAD,
  QUESTION_TOOL_NAME,
  showsScreen,
  type AskedQuestion,
  type ConversationQuestion,
} from "@corbits-builder/schemas/conversation";
import { screenWords } from "./roles.ts";

type TurnBody = {
  text: string;
  at: number;
  /** A turn's thinking and tool work, kept while this session saw it. Omitted turns are text only. */
  parts?: readonly ConversationPart[];
  /** The live turn while its message run is still going. */
  streaming?: boolean;
  /** The person's words on their way to the hub, not yet received. */
  sending?: boolean;
};

export type TranscriptTurn =
  | (TurnBody & { role: "person" })
  | (TurnBody & { role: "assistant" })
  | (TurnBody & { role: "participant"; sender: string });

export function turnItemId(turn: TranscriptTurn, index: number): string {
  return `${turn.role}:${String(turn.at)}:${String(index)}`;
}

export type DocumentApproval = {
  approvalId: string;
  toolName?: string;
  /** The ask's main argument, such as the address a browser tool opens. */
  subject?: string;
  packages?: readonly string[];
  /** When the native approval was raised, in ms; its card sits there in the thread. */
  at?: number;
  /** How the native record settled it, once it is no longer pending. */
  outcome?: ApprovalOutcome;
};

export type ApprovalOutcome = {
  readonly status: Exclude<ToolApprovalStatus, "pending">;
  /** "always" when the decision stands for the rest of the run. */
  readonly scope?: "once" | "always";
};

function documentHref(id: string): string {
  return `${DOCUMENT_LINK}${encodeURIComponent(id).replace(/[()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** One Markdown pass with document names as links, so a name inside a list keeps the list whole. */
function ChatProse({
  text,
  documents,
  onOpenDocument,
}: {
  text: string;
  documents: readonly NamedDocument[];
  onOpenDocument?: ((id: string) => void) | undefined;
}) {
  if (onOpenDocument === undefined) return <Markdown source={text} />;
  const source = proseSegments(text, documents)
    .map((segment) =>
      segment.kind === "text"
        ? segment.text
        : `[${segment.title.replace(/[[\]]/g, "")}](${documentHref(segment.id)})`,
    )
    .join("");
  return <Markdown source={source} openDocument={onOpenDocument} />;
}

/** A step as its row reads, and the face its opened output shows in. */
type ReadableTool = PartTool & { readonly face: Step["face"] };

/**
 * A call named by what it did, so the activity's live line and steps read like a person at work.
 * It opens onto the command it ran and what that printed, or onto what came of it in plain words;
 * never onto its arguments or a raw result. With nothing to show, the row has no toggle.
 */
function readableTool(
  part: PartTool,
  result: CallResult | undefined,
): ReadableTool {
  const { input, output: _output, ...call } = part;
  const settled = part.status === "output-available" || part.status === "error";
  const step = readStep(part.name, input, settled, result?.content);
  return {
    ...call,
    name: step.label,
    face: step.face,
    input: step.command,
    output: step.output,
  };
}

/** The item a specialist's row is, its own among the coordinator's steps. */
const workItemId = (unit: WorkUnit) => `work:${unit.key}`;

/** A run or filed thing with no hand-off in this session's view, placed at its start or filing. */
export type PlacedDispatch = {
  readonly at: number;
  readonly dispatch: Dispatch;
};

type ThreadItem =
  | { kind: "turn"; turn: TranscriptTurn; index: number }
  | { kind: "updates"; group: UpdateGroup }
  | { kind: "approval"; approval: DocumentApproval }
  | { kind: "unit"; unit: WorkUnit }
  | { kind: "questions"; question: ConversationQuestion };

type Placed =
  | { kind: "update"; at: number; update: SpecialistUpdate }
  | { kind: "approval"; at: number; approval: DocumentApproval }
  | { kind: "unit"; at: number; unit: WorkUnit }
  | { kind: "questions"; at: number; question: ConversationQuestion };

/**
 * The person's and the coordinator's turns in order, with the approvals,
 * questions and updates no hand-off answers placed between them by time. Each
 * hand-off and what came of it is one piece of work; a run with no call in view
 * stands at its latest report. Consecutive updates fold into groups. The live
 * turn stays last.
 */
function threadItems(
  turns: readonly TranscriptTurn[],
  threadUpdates: readonly SpecialistUpdate[],
  approvals: readonly DocumentApproval[],
  runs: readonly PlacedDispatch[],
  questions: readonly ConversationQuestion[],
  results: ReadonlyMap<string, CallResult>,
): { items: ThreadItem[]; specialists: Map<string, WorkUnit[]> } {
  const handoffs = turns.flatMap((turn) =>
    turn.role === "assistant"
      ? partsDispatches(visibleTurnParts(turn), results).map(
          (dispatch): PlacedDispatch => ({
            at: turn.at < 0 ? Number.POSITIVE_INFINITY : turn.at,
            dispatch,
          }),
        )
      : [],
  );
  const handed = new Set(handoffs.map(({ dispatch }) => dispatch.key));
  const work = workUnits(
    [...handoffs, ...runs],
    distinctUpdates([
      ...threadUpdates,
      ...turns.flatMap((turn) => {
        if (turn.role !== "participant") return [];
        const update = specialistUpdate(turn.sender, turn.text, turn.at);
        return update === null ? [] : [update];
      }),
    ]),
  );
  const specialists = new Map<string, WorkUnit[]>();
  for (const unit of work.units) {
    const same = specialists.get(unit.dispatch.call);
    if (same === undefined) specialists.set(unit.dispatch.call, [unit]);
    else same.push(unit);
  }
  const placed: Placed[] = [
    ...work.updates.map((update): Placed => ({
      kind: "update",
      at: update.at,
      update,
    })),
    ...approvals.map((approval): Placed => ({
      kind: "approval",
      at: approval.at ?? Number.POSITIVE_INFINITY,
      approval,
    })),
    ...work.units
      .filter((unit) => !handed.has(unit.key))
      .map((unit): Placed => ({
        kind: "unit",
        at: unit.at,
        unit,
      })),
    ...questions.map((question): Placed => ({
      kind: "questions",
      at: question.at,
      question,
    })),
  ].sort((left, right) => left.at - right.at);
  const items: ThreadItem[] = [];
  let next = 0;
  const flushBefore = (at: number) => {
    let run: SpecialistUpdate[] = [];
    const flushRun = () => {
      for (const group of groupUpdates(run))
        items.push({ kind: "updates", group });
      run = [];
    };
    for (; next < placed.length; next += 1) {
      const entry = placed[next];
      if (entry === undefined || entry.at >= at) break;
      if (entry.kind === "update") run.push(entry.update);
      else {
        flushRun();
        items.push(placedItem(entry));
      }
    }
    flushRun();
  };
  turns.forEach((turn, index) => {
    if (turn.role === "participant") return;
    flushBefore(turn.at < 0 ? Number.POSITIVE_INFINITY : turn.at);
    items.push({ kind: "turn", turn, index });
  });
  flushBefore(Number.POSITIVE_INFINITY);
  // An approval with no known time still shows, after everything else.
  for (; next < placed.length; next += 1) {
    const entry = placed[next];
    if (entry !== undefined && entry.kind !== "update")
      items.push(placedItem(entry));
  }
  return { items, specialists };
}

function placedItem(entry: Exclude<Placed, { kind: "update" }>): Card {
  if (entry.kind === "approval")
    return { kind: "approval", approval: entry.approval };
  if (entry.kind === "unit") return { kind: "unit", unit: entry.unit };
  return { kind: "questions", question: entry.question };
}

type Card = Exclude<ThreadItem, { kind: "turn" }>;

type Section =
  | { kind: "person"; turn: TranscriptTurn; index: number }
  | {
      kind: "coordinator";
      turns: { turn: TranscriptTurn; index: number }[];
      cards: Card[];
    };

/**
 * The thread cut at the person's turns and at their answered questions, which
 * answer as a turn would. Between two cuts the coordinator speaks once: its
 * turns' words under one header, then every card from that stretch in the
 * order they came.
 */
function threadSections(items: readonly ThreadItem[]): Section[] {
  const sections: Section[] = [];
  let open: Extract<Section, { kind: "coordinator" }> | null = null;
  for (const item of items) {
    if (item.kind === "turn" && item.turn.role === "person") {
      sections.push({ kind: "person", turn: item.turn, index: item.index });
      open = null;
      continue;
    }
    if (open === null) {
      open = { kind: "coordinator", turns: [], cards: [] };
      sections.push(open);
    }
    if (item.kind !== "turn") {
      open.cards.push(item);
      if (item.kind === "questions" && item.question.status === "answered")
        open = null;
      continue;
    }
    open.turns.push({ turn: item.turn, index: item.index });
  }
  return sections;
}

/**
 * A piece of work still at work is current, so it sits after the reports and decisions that came
 * while it ran rather than at the call that started it. A question waits on the person, so it stays
 * after those.
 */
function liveLast(
  cards: readonly Card[],
  live: (dispatch: Dispatch) => boolean,
): Card[] {
  const isLive = (card: Card) =>
    card.kind === "unit" && live(card.unit.dispatch);
  const isQuestion = (card: Card) => card.kind === "questions";
  return [
    ...cards.filter((card) => !isLive(card) && !isQuestion(card)),
    ...cards.filter(isLive),
    ...cards.filter(isQuestion),
  ];
}

const FOLD_AFTER = 3;

type ShownCard =
  | Exclude<Card, { kind: "unit" }>
  | { kind: "folded"; groups: UpdateGroup[]; hidden: boolean }
  | { kind: "units"; units: WorkUnit[] };

/**
 * Report rows in a row gather in one list, and more than three open folded, so decisions and
 * hand-offs stay in view.
 */
function foldUpdates(cards: readonly Card[]): ShownCard[] {
  const shown: ShownCard[] = [];
  let run: UpdateGroup[] = [];
  const flush = () => {
    if (run.length > 1)
      shown.push({
        kind: "folded",
        groups: run,
        hidden: run.length > FOLD_AFTER,
      });
    else for (const group of run) shown.push({ kind: "updates", group });
    run = [];
  };
  for (const card of cards) {
    if (card.kind === "updates") {
      run.push(card.group);
      continue;
    }
    flush();
    const last = shown.at(-1);
    if (card.kind !== "unit") shown.push(card);
    else if (last?.kind === "units") last.units.push(card.unit);
    else shown.push({ kind: "units", units: [card.unit] });
  }
  flush();
  return shown;
}

/**
 * A turn's parts in words, with its questions taken out to their own cards. A call that returned an
 * error settles as a plain finished step, with no error details, because the agent corrects it and
 * to the person it is a step that happened.
 */
function readableParts(
  parts: readonly ConversationPart[],
  results: ReadonlyMap<string, CallResult>,
): readonly ConversationPart[] {
  return parts.flatMap((part): ConversationPart[] => {
    if (part.kind !== "tool-trace") return [part];
    if (part.name === QUESTION_TOOL_NAME) return [];
    // An execute call that opens a screen is represented by the screen's card, as a question is.
    if (part.name === "execute" && namesScreen(part.input)) return [];
    const result = results.get(part.toolCallId);
    return [readableTool(part, result?.isError === true ? undefined : result)];
  });
}

/** A step's row: its words, or a command shown as itself after "Ran". */
function StepLabel({ part }: { part: PartTool }) {
  const command = typeof part.input === "string" ? part.input : undefined;
  if (command === undefined || part.name !== commandLine(command))
    return part.name;
  return (
    <span title={command}>
      {wording.activity.ran(part.status === "output-available")}{" "}
      <code className={styles.command}>{part.name}</code>
    </span>
  );
}

const renderWords = (value: unknown) => (
  <span className={styles.words}>{String(value)}</span>
);

/** The library's tool call, labelled in words, opening onto its command and output or a line of words. */
function ToolLine({ part }: { part: PartTool }) {
  const code = "face" in part && part.face === "code";
  return (
    <Tool part={{ ...part, name: "" }}>
      <ToolHeader
        label={<StepLabel part={part} />}
        statusLabels={wording.activity.status}
      />
      <ToolInput title={wording.activity.command} />
      <ToolOutput
        title={code ? wording.activity.commandOutput : wording.activity.output}
        render={code ? undefined : renderWords}
      />
    </Tool>
  );
}

/** One opened step: each call a row that opens onto what it was given and what came back. */
function renderStep(step: ActivityStep): ReactNode {
  return step.kind === "tool-trace" ? <ToolLine part={step} /> : null;
}

/**
 * A run of the coordinator's work. It starts folded to its count, so the conversation reads as
 * what was said, and stays as the person leaves it: the end of the work never folds or opens it, so
 * the page does not move. Its header counts its steps, so it never repeats a lone row.
 */
function Run({ steps }: { steps: readonly ActivityStep[] }) {
  return (
    <Activity steps={steps}>
      <ActivityTrigger
        label={wording.activity.run(steps.length)}
        labels={wording.activity.trigger}
        className={styles.run}
      />
      <ActivityContent renderStep={renderStep} />
    </Activity>
  );
}

/** The coordinator's quiet line while it works, the one live line of its turn. */
function ThinkingLine() {
  return (
    <span className={styles.thinking}>
      <ShimmerText role="status">{wording.activity.thinkingNow}</ShimmerText>
    </span>
  );
}

/** Copies a message's words to the clipboard, and says so for a moment. */
function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (cause) {
      if (!(cause instanceof DOMException)) throw cause;
      toast.error(wording.message.copyFailed);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <MessageAction
      label={copied ? wording.message.copied : wording.message.copy}
      onClick={() => void copy()}
      data-copied={copied ? "" : undefined}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? wording.message.copied : wording.message.copy}
    </MessageAction>
  );
}

const COPIED_MS = 2_000;

/** The name of what was asked: a screen by what it is for, else the first question's own header. */
function askedLabel(asked: AskedQuestion): string {
  if (!("plugin" in asked))
    return asked.questions[0]?.header ?? wording.questions.title(1);
  return (
    screenWords(asked.plugin, asked.action ?? "")?.label(asked.input) ??
    wording.questions.title(1)
  );
}

const wordsOf = (parts: readonly ConversationPart[]) =>
  parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();

/** The quiet line for a note the hub mailed as the person. */
function hubNoteLine(text: string): string | undefined {
  return text.slice(HUB_NOTE_LEAD.length).split("\n\n", 1)[0];
}

// The hub's note that a specialist ended: the person's line, then a coordinator-only paragraph
// quoting the native reason.
const RECORDED_REASON = /Recorded reason(?: \(([^)]+)\))?: ([\s\S]*)$/;

/** A specialist-ended notice in plain words; the recorded reason stays under Details. */
function SpecialistEnded({ text }: { text: string }) {
  const [line = "", rest = ""] = text.split(/\n\n([\s\S]*)/);
  const recorded = RECORDED_REASON.exec(rest);
  const code = recorded?.[1];
  const cause =
    code === undefined ? undefined : wording.specialistEnded.cause[code];
  return (
    <span>
      {cause === undefined ? line : `${line.replace(/\.$/, "")} (${cause}).`}{" "}
      {wording.specialistEnded.restart}
      {recorded === null ? null : (
        <details className={styles.endedDetails}>
          <summary>{wording.specialistEnded.details}</summary>
          {code === undefined ? recorded[2] : `${code}: ${recorded[2] ?? ""}`}
        </details>
      )}
    </span>
  );
}

/**
 * Some person turns are the hub writing as the person: an import's opening and
 * a hub note. They read as a divider or a notice, never as a
 * message.
 */
type PersonTurnKind = "divider" | "notice" | "message";

function personTurnKind(text: string): PersonTurnKind {
  if (text.startsWith(IMPORTED_PROJECT_LEAD)) return "divider";
  if (text.startsWith(HUB_NOTE_LEAD)) return "notice";
  return "message";
}

// The thread only records questions and decisions; answering and deciding happen in the prompt box.
const settled = () => Promise.resolve(false);
const decided = () => {};

/** What the thread shows and what the person can do in it. */
export type RoomThreadContent = {
  turns: readonly TranscriptTurn[];
  /** Specialist mail from their own threads, folded in between the turns. */
  updates?: readonly SpecialistUpdate[];
  /** The reader's latest send, so the conversation follows the reply to it. */
  sentId?: string;
  /** The colleague is working on a reply. */
  thinking?: boolean;
  /** Which pieces of the agents' activity are drawn. */
  shows?: ActivityShown;
  /** Documents the person can open from a name in the conversation. */
  documents?: readonly NamedDocument[];
  /** Opens that document over the room. The id is not shown. */
  onOpenDocument?: (id: string) => void;
  /** Decisions, each shown once it settled; one still pending waits in the prompt box. */
  approvals?: readonly DocumentApproval[];
  /** Native results of the coordinator's calls this session saw, by call id. */
  results?: ReadonlyMap<string, CallResult>;
  /** Runs and filed things with no hand-off in view, placed at their start or filing. */
  runs?: readonly PlacedDispatch[];
  /** The hand-off's run is still starting or at work. */
  live?: (dispatch: Dispatch) => boolean;
  /** A piece of work as its step shows it, by where its hand-off stands. */
  standing: (unit: WorkUnit) => WorkUnitStanding;
  /**
   * The coordinator's questions from its run logs, earlier runs' and this one's, each shown once
   * answered or closed; the open one waits in the prompt box or the plugin space.
   */
  questions?: readonly ConversationQuestion[];
  /** The project's values a plugin's screen reads and saves. */
  projectValues?: ProjectValuesStore;
  /** Finds the screen a question names, among the plugins the project uses. */
  screenOf?: ScreenLookup;
  /** What the interface supplies a plugin's screen beyond its input. */
  screenSupplies?: HostSupplies;
};

export type RoomThreadProps = RoomThreadContent & {
  /** Agent output rendered in the same log, after the turns. */
  children?: ReactNode;
};

export function RoomThread({
  turns,
  updates = [],
  sentId,
  thinking = false,
  shows = ACTIVITY_SHOWN,
  documents = [],
  onOpenDocument,
  results = new Map(),
  runs = [],
  live = () => false,
  standing,
  approvals = [],
  questions = [],
  projectValues,
  screenOf,
  screenSupplies,
  children,
}: RoomThreadProps) {
  const renderTurnText = (part: PartText) => (
    <MessageFold length={part.text.length}>
      <MessageContent
        text={part.text}
        render={(text) => (
          <ChatProse
            text={text}
            documents={documents}
            onOpenDocument={onOpenDocument}
          />
        )}
      />
    </MessageFold>
  );
  const thread = threadItems(
    turns,
    updates,
    approvals.filter((approval) => approval.outcome !== undefined),
    runs,
    questions.filter((question) => question.status !== "open"),
    results,
  );
  const { specialists } = thread;
  // Work still running always shows, in the list under the reply; done, it shows only when asked for.
  const showsUnit = (unit: WorkUnit) =>
    shows.specialists || inProgress(standing(unit).status);
  const items = thread.items.filter(
    (item) => item.kind !== "unit" || showsUnit(item.unit),
  );
  // A call that started specialists stands for them; any other is one of the coordinator's own steps.
  const shownParts = (turn: TranscriptTurn) =>
    readableParts(visibleTurnParts(turn), results).filter((part) => {
      if (part.kind !== "tool-trace") return true;
      const started = specialists.get(part.toolCallId);
      return started !== undefined
        ? started.some(showsUnit)
        : shows.coordinatorSteps;
    });
  const thinkingShown = thinking && shows.thinking;
  // A specialist's own steps, one level in, as its row opens onto them, each with what it returned.
  const specialistRun = (steps: readonly PartTool[]) => (
    <Activity
      steps={steps.map((step) => {
        const result = results.get(step.toolCallId);
        return readableTool(
          step,
          result?.isError === true ? undefined : result,
        );
      })}
      open
    >
      <ActivityContent renderStep={renderStep} />
    </Activity>
  );
  // Each specialist is its own row and its own item.
  const specialistRow = (unit: WorkUnit, row = standing(unit)) => {
    return (
      <ConversationItem key={unit.key} itemId={workItemId(unit)}>
        <WorkUnitStepView
          {...row}
          steps={shows.specialistSteps ? row.steps : []}
          document={shows.specialistDocument ? row.document : undefined}
          instruction={
            shows.specialistInstruction ? row.instruction : undefined
          }
          report={shows.specialistReport ? row.report : undefined}
          run={specialistRun}
        />
      </ConversationItem>
    );
  };
  // Work done or ended keeps its own rows; what still runs gathers in one list after them.
  const specialistRows = (units: readonly WorkUnit[]) => {
    const rows = units
      .filter(showsUnit)
      .map((unit) => ({ unit, row: standing(unit) }));
    const running = rows.filter(({ row }) => inProgress(row.status));
    return (
      <>
        {rows
          .filter(({ row }) => !inProgress(row.status))
          .map(({ unit, row }) => specialistRow(unit, row))}
        {running.length === 0 ? null : (
          <WorkInProgress count={running.length}>
            {running.map(({ unit, row }) => specialistRow(unit, row))}
          </WorkInProgress>
        )}
      </>
    );
  };
  const started = (step: ActivityStep) =>
    step.kind === "tool-trace" ? specialists.get(step.toolCallId) : undefined;
  const renderActivity = (steps: readonly ActivityStep[]) => (
    <>
      <Run steps={steps.filter((step) => started(step) === undefined)} />
      {specialistRows(steps.flatMap((step) => started(step) ?? []))}
    </>
  );
  // The coordinator and the person are told apart by where their words sit, so neither is named on
  // the page; a screen reader hears the name from each message's label.
  const renderCard = (card: ShownCard, position: string) => {
    if (card.kind === "units")
      return (
        <ConversationItem
          key={`units:${card.units[0]?.key ?? position}`}
          itemId={`units:${card.units[0]?.key ?? position}`}
        >
          <Message from="agent" aria-label={wording.speaker.coordinator}>
            {specialistRows(card.units)}
          </Message>
        </ConversationItem>
      );
    if (card.kind === "folded")
      return (
        <FoldedUpdatesView
          key={`folded:${card.groups[0]?.key ?? position}`}
          startHidden={card.hidden}
          rows={card.groups.map((group) =>
            updatesRow(group, updateSubject(group.sender)),
          )}
        />
      );
    if (card.kind === "updates")
      return renderUpdates(card.group, updateSubject(card.group.sender));
    if (card.kind === "questions") {
      const { question } = card;
      const { signalName } = question;
      if (showsScreen(question)) {
        const shown =
          question.status === "answered" ? (
            <ScreenQuestion
              signalName={signalName}
              host={screenOf?.(question.asked)?.host}
              input={question.asked.input}
              projectValues={projectValues}
              answer={question.answer}
              disabled
              onAnswer={settled}
              supplies={screenSupplies}
            />
          ) : (
            <ClosedQuestions asks={[askedLabel(question.asked)]} />
          );
        return (
          <ConversationItem key={signalName} itemId={`questions:${signalName}`}>
            <Message from="agent" aria-label={wording.speaker.coordinator}>
              <QuestionEntry signalName={signalName}>{shown}</QuestionEntry>
            </Message>
          </ConversationItem>
        );
      }
      return (
        <ConversationItem key={signalName} itemId={`questions:${signalName}`}>
          <Message from="agent" aria-label={wording.speaker.coordinator}>
            <QuestionEntry signalName={signalName}>
              <QuestionsCard question={question} disabled onAnswer={settled} />
            </QuestionEntry>
          </Message>
        </ConversationItem>
      );
    }
    return renderApproval(card.approval, position);
  };
  const renderUpdates = (group: UpdateGroup, subject: string | undefined) => (
    <SpecialistUpdatesView key={group.key} row={updatesRow(group, subject)} />
  );
  // A settled decision is a record: nothing on it decides anything.
  const decisionCard = (approval: DocumentApproval) =>
    approval.packages ? (
      <PackageDecision
        approvalId={approval.approvalId}
        packages={approval.packages}
        {...(approval.outcome === undefined
          ? {}
          : { outcome: approval.outcome })}
        disabled
        onYes={decided}
        onAlways={decided}
        onNo={decided}
      />
    ) : (
      <DocumentDecision
        approval={approval}
        {...(onOpenDocument === undefined
          ? {}
          : { onShowDocument: onOpenDocument })}
        disabled
        onYes={decided}
        onAlways={decided}
        onNo={decided}
      />
    );
  const renderApproval = (approval: DocumentApproval, position: string) => (
    <ConversationItem
      key={approval.approvalId}
      itemId={`document-decision:${approval.at === undefined ? position : String(approval.at)}`}
    >
      {/* A package decision is the coder's, which the conversation does name. */}
      <Message
        from="agent"
        {...(approval.packages
          ? {}
          : { "aria-label": wording.speaker.coordinator })}
      >
        {approval.packages ? (
          <MessageHeader name={wording.speaker.coder} />
        ) : null}
        {decisionCard(approval)}
      </Message>
    </ConversationItem>
  );
  const renderMessage = (
    itemId: string,
    turn: TranscriptTurn,
    visible: readonly ConversationPart[],
    streaming: boolean,
    thinkingHere: boolean,
  ) => (
    <ConversationItem key={itemId} itemId={itemId}>
      <Message
        from={turn.role === "person" ? "own" : "agent"}
        status={
          streaming ? "streaming" : turn.sending === true ? "sending" : "sent"
        }
        {...(turn.role === "participant"
          ? {}
          : { "aria-label": turnLabel(turn) })}
      >
        {/* Only a specialist speaking in the conversation is named, as it is not the coordinator. */}
        {turn.role === "participant" ? (
          <MessageHeader name={turnLabel(turn)} />
        ) : null}
        <MessageParts
          parts={visible}
          streaming={streaming}
          renderText={renderTurnText}
          renderActivity={renderActivity}
        />
        <MessageSendStatus />
        {thinkingHere ? (
          <MessageFooter className={styles.footer}>
            <ThinkingLine />
          </MessageFooter>
        ) : null}
        {!thinkingHere &&
        turn.role === "assistant" &&
        !streaming &&
        wordsOf(visible) !== "" ? (
          <MessageFooter className={styles.footer}>
            <MessageActions aria-label={wording.message.actions}>
              <CopyAction text={wordsOf(visible)} />
            </MessageActions>
          </MessageFooter>
        ) : null}
      </Message>
    </ConversationItem>
  );
  const sections = threadSections(items);
  // The coordinator's turn shows one live line while it works, at the bottom: in its last message's
  // footer when its words end the conversation, so its copy action takes the line's place when the
  // turn ends, else on its own under the last card. A run above a card is not the bottom.
  const last = sections.at(-1);
  const wordsLast =
    last?.kind === "coordinator" &&
    last.cards.length === 0 &&
    last.turns.some(({ turn }) => shownParts(turn).length > 0);
  return (
    // The view follows the reply to its end once the person sends, and stays put when they scroll
    // away, so a long answer is read without chasing it.
    <Conversation
      scrollPolicy="stick"
      sentId={sentId}
      className={styles.thread}
    >
      <ConversationContent
        aria-label={wording.conversation.label}
        className={styles.log}
      >
        {sections.map((section, position) => {
          if (section.kind === "coordinator") {
            const first = section.turns[0];
            const visible = section.turns.flatMap(({ turn }) =>
              shownParts(turn),
            );
            const said = first !== undefined && visible.length > 0;
            const streaming = section.turns.some(
              ({ turn }) => turn.streaming === true,
            );
            return (
              <Fragment
                key={
                  first === undefined
                    ? `cards:${String(position)}`
                    : turnItemId(first.turn, first.index)
                }
              >
                {said
                  ? renderMessage(
                      turnItemId(first.turn, first.index),
                      first.turn,
                      visible,
                      streaming,
                      thinkingShown && section === last && wordsLast,
                    )
                  : null}
                {foldUpdates(liveLast(section.cards, live)).map((card, at) =>
                  renderCard(card, `${String(position)}:${String(at)}`),
                )}
              </Fragment>
            );
          }
          const { turn, index } = section;
          const itemId = turnItemId(turn, index);
          const entry = personTurnKind(turn.text);
          if (entry === "divider")
            return (
              <ConversationItem key={itemId} itemId={itemId}>
                <ConversationDivider>
                  {wording.projectImported}
                </ConversationDivider>
              </ConversationItem>
            );
          if (entry === "notice")
            return (
              <ConversationItem key={itemId} itemId={itemId}>
                <ConversationNotice>
                  {RECORDED_REASON.test(turn.text) ? (
                    <SpecialistEnded
                      text={turn.text.slice(HUB_NOTE_LEAD.length)}
                    />
                  ) : (
                    hubNoteLine(turn.text)
                  )}
                </ConversationNotice>
              </ConversationItem>
            );
          const visible = visibleTurnParts(turn);
          const streaming = turn.streaming === true;
          return visible.length === 0
            ? null
            : renderMessage(itemId, turn, visible, streaming, false);
        })}
        {thinkingShown && !wordsLast ? (
          <ConversationItem itemId="colleague-thinking">
            <Message
              from="agent"
              status="streaming"
              aria-label={wording.speaker.coordinator}
            >
              <ThinkingLine />
            </Message>
          </ConversationItem>
        ) : null}
        {children}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
