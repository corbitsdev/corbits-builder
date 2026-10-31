/**
 * Committed person and assistant turns, drawn through the vendored
 * MessageParts path. The body is the human-readable turn: questions,
 * decisions, documents, and plain failures. Tool names, ids, hashes, and
 * status payloads stay on the turn data and out of the transcript. A pending
 * native approval is still a decision on the existing path. This view does
 * not invent a coordinator turn, and it does not decide an approval on its own.
 */
import {
  IMPORTED_PROJECT_LEAD,
  SPECIALIST_ENDED_LEAD,
  wording,
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
  ConversationMap,
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
  Reasoning,
  ThinkingIndicator,
  Tool,
  ToolGroup,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ActivityStep,
  type ConversationMapTurn,
  type ConversationPart,
  type PartText,
  type PartTool,
  type ToolApprovalDecision,
  type ToolApprovalStatus,
} from "@corbits/react-ui";
import { toolPhrase, toolSubject } from "./agent-activity.tsx";
import { DOCUMENT_LINK, Markdown } from "../../markdown.jsx";
import { toast } from "sonner";
import { CONV_SCROLL_CLASS } from "./pane-classes.ts";
import { proseSegments, type NamedDocument } from "./collaboration.ts";
import { DocumentDecision, PackageDecision } from "./document-decision.tsx";
import { TypedYesCountdown, type TypedYes } from "./typed-yes.tsx";
import { turnLabel, visibleTurnParts } from "./visible-chat.ts";
import {
  distinctUpdates,
  FoldedUpdates,
  groupUpdates,
  specialistUpdate,
  SpecialistUpdates,
  updateSubject,
  type SpecialistUpdate,
  type UpdateGroup,
} from "./specialist-updates.tsx";
import {
  DISPATCH_TOOLS,
  partsDispatches,
  type Dispatch,
} from "./dispatch-card.tsx";
import { workUnits, type WorkUnit } from "./work-unit.ts";
import { WorkUnitView } from "./work-unit-view.tsx";
import type { CallResult } from "./live-run.ts";
import {
  askedQuestions,
  QuestionsCard,
  type QuestionsState,
} from "./questions-card.tsx";
import type { AskQuestions } from "@corbits-builder/schemas/questions";

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
  /** The document the approval approves, when it singles one out. */
  document?: {
    readonly kind: string;
    readonly title: string;
    readonly version: number;
  };
  /** The documents the approval signs off together, when it covers several. */
  sources?: readonly {
    readonly kind: string;
    readonly title: string;
    readonly version: number;
  }[];
  toolName?: string;
  /** The document kinds a request_approval ask names. */
  kinds?: readonly string[];
  instruction?: string;
  /** The ask's main argument, such as the address a browser tool opens. */
  subject?: string;
  packages?: readonly string[];
  /** The design concepts the approval starts, by name and art direction. */
  concepts?: readonly { readonly label: string; readonly direction: string }[];
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

const sentenceCase = (kind: string) => {
  const words = kind.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function instructionOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const instruction = (input as Record<string, unknown>)["instruction"];
  return typeof instruction === "string" && instruction.trim() !== ""
    ? instruction
    : undefined;
}

function resultValue(content: unknown): unknown {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

/**
 * A call named in plain words, so the activity's live line and steps read like
 * a person at work. A finished hand-off says whom it started. Opened, it shows
 * its instruction, else its arguments, and what the call returned.
 */
function readableTool(
  part: PartTool,
  result: CallResult | undefined,
): PartTool {
  const { input, output: _output, ...call } = part;
  const subject = toolSubject(input);
  const handoff = wording.activity.handoff[part.name];
  const name =
    handoff !== undefined && part.status === "output-available"
      ? handoff(subject === undefined ? undefined : sentenceCase(subject))
      : toolPhrase(part.name, subject);
  return {
    ...call,
    name,
    ...(input === undefined ? {} : { input: instructionOf(input) ?? input }),
    ...(result === undefined
      ? {}
      : {
          output: resultValue(result.content),
          ...(result.isError ? { status: "error" as const } : {}),
        }),
  };
}

/** A finished turn's work folds into one run before its words, so it reads "3 steps". */
function settledParts(
  parts: readonly ConversationPart[],
): readonly ConversationPart[] {
  const words = parts.filter((part) => part.kind === "text");
  return [...parts.filter((part) => part.kind !== "text"), ...words];
}

/** A run at work with no hand-off in this session's view, placed at its start. */
export type PlacedDispatch = {
  readonly at: number;
  readonly dispatch: Dispatch;
};

/** The coordinator's ask to choose a design, placed when it was answered, else last. */
export type PlacedChoice = { readonly at?: number; readonly card: ReactNode };

type ThreadItem =
  | { kind: "turn"; turn: TranscriptTurn; index: number }
  | { kind: "updates"; group: UpdateGroup }
  | { kind: "approval"; approval: DocumentApproval }
  | { kind: "unit"; unit: WorkUnit }
  | { kind: "choice"; card: ReactNode }
  | { kind: "questions"; callId: string; ask: AskQuestions };

type Placed =
  | { kind: "update"; at: number; update: SpecialistUpdate }
  | { kind: "approval"; at: number; approval: DocumentApproval }
  | { kind: "unit"; at: number; unit: WorkUnit }
  | { kind: "choice"; at: number; card: ReactNode };

/**
 * The person's and the coordinator's turns in order, with each hand-off and
 * what came of it as one piece of work, and the updates and approvals no
 * hand-off answers, placed between them by time. A piece of work stands at its
 * latest report or approval. Consecutive updates fold into groups. The live
 * turn stays last.
 */
function threadItems(
  turns: readonly TranscriptTurn[],
  threadUpdates: readonly SpecialistUpdate[],
  approvals: readonly DocumentApproval[],
  runs: readonly PlacedDispatch[],
  choice: PlacedChoice | undefined,
  results: ReadonlyMap<string, CallResult>,
): ThreadItem[] {
  const handoffs = [
    ...turns.flatMap((turn) =>
      turn.role === "assistant"
        ? partsDispatches(visibleTurnParts(turn), results).map(
            (dispatch): PlacedDispatch => ({
              at: turn.at < 0 ? Number.POSITIVE_INFINITY : turn.at,
              dispatch,
            }),
          )
        : [],
    ),
    ...runs,
  ];
  const work = workUnits(
    handoffs,
    distinctUpdates([
      ...threadUpdates,
      ...turns.flatMap((turn) => {
        if (turn.role !== "participant") return [];
        const update = specialistUpdate(turn.sender, turn.text, turn.at);
        return update === null ? [] : [update];
      }),
    ]),
    approvals,
  );
  const placed: Placed[] = [
    ...work.updates.map((update): Placed => ({
      kind: "update",
      at: update.at,
      update,
    })),
    ...work.approvals.map((approval): Placed => ({
      kind: "approval",
      at: approval.at ?? Number.POSITIVE_INFINITY,
      approval,
    })),
    ...work.units.map((unit): Placed => ({
      kind: "unit",
      at: unit.at,
      unit,
    })),
    ...(choice === undefined
      ? []
      : [
          {
            kind: "choice",
            at: choice.at ?? Number.POSITIVE_INFINITY,
            card: choice.card,
          } satisfies Placed,
        ]),
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
  // An approval or choice with no known time still shows, after everything else.
  for (; next < placed.length; next += 1) {
    const entry = placed[next];
    if (entry !== undefined && entry.kind !== "update")
      items.push(placedItem(entry));
  }
  return items;
}

function placedItem(entry: Exclude<Placed, { kind: "update" }>): Card {
  if (entry.kind === "approval")
    return { kind: "approval", approval: entry.approval };
  if (entry.kind === "unit") return { kind: "unit", unit: entry.unit };
  return { kind: "choice", card: entry.card };
}

type Card = Exclude<ThreadItem, { kind: "turn" }>;

type Section =
  | { kind: "person"; turn: TranscriptTurn; index: number }
  | {
      kind: "coordinator";
      turns: { turn: TranscriptTurn; index: number }[];
      cards: Card[];
    };

function toolsOf(parts: readonly ConversationPart[]): readonly PartTool[] {
  return parts.flatMap((part) =>
    part.kind === "tool-trace"
      ? [part]
      : part.kind === "tool-batch"
        ? part.tools
        : [],
  );
}

/**
 * The thread cut at the person's turns. Between two of them the coordinator
 * speaks once: its turns' words under one header, then every card from that
 * stretch in the order they came.
 */
function threadSections(
  items: readonly ThreadItem[],
  results: ReadonlyMap<string, CallResult>,
): Section[] {
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
      continue;
    }
    open.turns.push({ turn: item.turn, index: item.index });
    for (const tool of toolsOf(visibleTurnParts(item.turn))) {
      const ask = askedQuestions(tool, results.get(tool.toolCallId));
      if (ask !== undefined)
        open.cards.push({ kind: "questions", callId: tool.toolCallId, ask });
    }
  }
  return sections;
}

/**
 * A piece of work still at work is current, so it sits after the reports and decisions that came
 * while it ran rather than at the call that started it. The design choice waits on the person, so it
 * stays after those.
 */
function liveLast(
  cards: readonly Card[],
  live: (dispatch: Dispatch) => boolean,
): Card[] {
  const isLive = (card: Card) =>
    card.kind === "unit" && live(card.unit.dispatch);
  const isChoice = (card: Card) =>
    card.kind === "choice" || card.kind === "questions";
  return [
    ...cards.filter((card) => !isLive(card) && !isChoice(card)),
    ...cards.filter(isLive),
    ...cards.filter(isChoice),
  ];
}

const FOLD_AFTER = 3;

type ShownCard = Card | { kind: "folded"; groups: UpdateGroup[] };

/** More than three report rows in a row fold under one line, so decisions and hand-offs stay in view. */
function foldUpdates(cards: readonly Card[]): ShownCard[] {
  const shown: ShownCard[] = [];
  let run: UpdateGroup[] = [];
  const flush = () => {
    if (run.length > FOLD_AFTER) shown.push({ kind: "folded", groups: run });
    else for (const group of run) shown.push({ kind: "updates", group });
    run = [];
  };
  for (const card of cards) {
    if (card.kind === "updates") run.push(card.group);
    else {
      flush();
      shown.push(card);
    }
  }
  flush();
  return shown;
}

/** A turn's parts with its hand-offs and questions taken out: each becomes its own card after the turn. */
function readableParts(
  parts: readonly ConversationPart[],
  results: ReadonlyMap<string, CallResult>,
): readonly ConversationPart[] {
  const carded = (tool: PartTool) =>
    DISPATCH_TOOLS.has(tool.name) ||
    askedQuestions(tool, results.get(tool.toolCallId)) !== undefined;
  return parts.flatMap((part): ConversationPart[] => {
    const readable = (tool: PartTool) =>
      readableTool(tool, results.get(tool.toolCallId));
    if (part.kind === "tool-trace") return carded(part) ? [] : [readable(part)];
    if (part.kind === "tool-batch") {
      const tools = part.tools.filter((tool) => !carded(tool)).map(readable);
      const [only] = tools;
      if (only === undefined) return [];
      return tools.length === 1 ? [only] : [{ ...part, tools }];
    }
    return [part];
  });
}

/** The library's tool call, labelled in words rather than by its raw name. */
function ToolLine({ part }: { part: PartTool }) {
  return (
    <Tool part={{ ...part, name: "" }}>
      <ToolHeader label={part.name} statusLabels={wording.activity.status} />
      {typeof part.input === "string" ? (
        <ToolInput
          title={wording.activity.instruction}
          render={(value) => <Markdown source={String(value)} />}
        />
      ) : (
        <ToolInput title={wording.activity.input} />
      )}
      <ToolOutput
        title={wording.activity.output}
        errorTitle={wording.activity.outputError}
      />
    </Tool>
  );
}

/** One opened step: each call a row that opens onto what it was given and what came back. */
function renderStep(step: ActivityStep): ReactNode {
  if (step.kind === "reasoning") return <Reasoning part={step} />;
  if (step.kind === "tool-trace") return <ToolLine part={step} />;
  return (
    <ToolGroup
      part={step}
      labels={wording.activity.group}
      renderTool={(tool) => <ToolLine part={tool} />}
    />
  );
}

/** Copies a message's words to the clipboard, and says so for a moment. */
function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      label={copied ? wording.message.copied : wording.message.copy}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), COPIED_MS);
          },
          () => toast.error(wording.message.copyFailed),
        );
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </MessageAction>
  );
}

const COPIED_MS = 2_000;
// A tick's name is the person's words; a long message is named by its opening.
const MAP_LABEL_CHARS = 160;

const wordsOf = (parts: readonly ConversationPart[]) =>
  parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();

/** A finished run's one line: thought keeps the library's summary, tool work alone is named in words. */
function runLabel(steps: readonly ActivityStep[]): string | undefined {
  if (steps.some((step) => step.kind === "reasoning")) return undefined;
  const tools = steps.flatMap((step): readonly PartTool[] =>
    step.kind === "tool-batch"
      ? step.tools
      : step.kind === "tool-trace"
        ? [step]
        : [],
  );
  const only = tools.length === 1 ? tools[0]?.name : undefined;
  return wording.activity.run(
    tools.length,
    only === undefined || only === ""
      ? undefined
      : only.charAt(0).toUpperCase() + only.slice(1),
  );
}

// The hub's notice: the person's line, then a coordinator-only paragraph quoting the native reason.
const RECORDED_REASON = /Recorded reason(?: \(([^)]+)\))?: ([\s\S]*)$/;

/** A specialist-ended notice in plain words; the recorded reason stays under Details. */
function SpecialistEnded({ text }: { text: string }) {
  const [line = "", rest = ""] = text.split(/\n\n([\s\S]*)/);
  const recorded = RECORDED_REASON.exec(rest);
  const code = recorded?.[1];
  const cause =
    code === undefined ? undefined : wording.specialistEnded.cause[code];
  return (
    <span className="specialist-ended">
      {cause === undefined ? line : `${line.replace(/\.$/, "")} (${cause}).`}{" "}
      {wording.specialistEnded.restart}
      {recorded === null ? null : (
        <details className="specialist-ended-details">
          <summary>{wording.specialistEnded.details}</summary>
          {code === undefined ? recorded[2] : `${code}: ${recorded[2] ?? ""}`}
        </details>
      )}
    </span>
  );
}

export function RoomThread({
  turns,
  updates = [],
  sentId,
  thinking = false,
  documents = [],
  onOpenDocument,
  shownDocument = null,
  approvals = [],
  results = new Map(),
  runs = [],
  designChoice,
  live = () => false,
  onDecide,
  onRequestChanges,
  approvalDisabled = false,
  approvalError,
  typedYes,
  onAnswerQuestions,
  questionsDisabled = false,
  children,
}: {
  turns: readonly TranscriptTurn[];
  /** Specialist mail from their own threads, folded in between the turns. */
  updates?: readonly SpecialistUpdate[];
  /** The reader's latest send, so the conversation settles on it. */
  sentId?: string;
  /** The colleague is working on a reply. */
  thinking?: boolean;
  /** Documents the person can open from a name in the conversation. */
  documents?: readonly NamedDocument[];
  /** Opens that document in the reading pane. The id is not shown. */
  onOpenDocument?: (id: string) => void;
  /** The document the reading pane shows, by kind, so a card can say where it is. */
  shownDocument?: string | null;
  /** Pending document decisions. Not decided here. */
  approvals?: readonly DocumentApproval[];
  /** Native results of the coordinator's calls this session saw, by call id. */
  results?: ReadonlyMap<string, CallResult>;
  /** Runs at work with no hand-off in view, placed at their start. */
  runs?: readonly PlacedDispatch[];
  designChoice?: PlacedChoice;
  /** The hand-off's run is still starting or at work. */
  live?: (dispatch: Dispatch) => boolean;
  onDecide?: (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
  }) => void;
  /** Takes the person to the composer to say what should change. */
  onRequestChanges?: () => void;
  approvalDisabled?: boolean;
  approvalError?: string;
  /** A typed yes counting down on the card it will approve. */
  typedYes?: { held: TypedYes; onUndo: () => void };
  /** Sends the person's answers to the coordinator's questions as their next message. */
  onAnswerQuestions?: (reply: string) => Promise<boolean>;
  questionsDisabled?: boolean;
  /** Agent output rendered in the same log, after the turns. */
  children?: ReactNode;
}) {
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
  // Under a coordinator header, a coordinator's approval card does not repeat the name.
  const renderCard = (
    card: ShownCard,
    position: string,
    headed: boolean,
    questions: (callId: string) => QuestionsState,
  ) => {
    if (card.kind === "unit")
      return (
        <WorkUnitView
          key={`unit:${card.unit.key}`}
          unit={card.unit}
          renderStep={renderStep}
          renderDecision={decisionCard}
        />
      );
    if (card.kind === "folded")
      return (
        <FoldedUpdates
          key={`folded:${card.groups[0]?.key ?? position}`}
          groups={card.groups}
          subjects={
            new Map(
              card.groups.flatMap((group) => {
                const subject = updateSubject(group.sender);
                return subject === undefined ? [] : [[group.key, subject]];
              }),
            )
          }
        />
      );
    if (card.kind === "updates")
      return renderUpdates(card.group, updateSubject(card.group.sender));
    if (card.kind === "questions")
      return (
        <ConversationItem key={card.callId} itemId={`questions:${card.callId}`}>
          <Message from="agent">
            {headed ? null : (
              <MessageHeader name={wording.speaker.coordinator} />
            )}
            <QuestionsCard
              id={card.callId}
              ask={card.ask}
              state={questions(card.callId)}
            />
          </Message>
        </ConversationItem>
      );
    if (card.kind === "choice")
      return (
        <ConversationItem key="design-choice" itemId="design-choice">
          <Message from="agent">
            {headed ? null : (
              <MessageHeader name={wording.speaker.coordinator} />
            )}
            {card.card}
          </Message>
        </ConversationItem>
      );
    return renderApproval(card.approval, position, headed);
  };
  const renderUpdates = (group: UpdateGroup, subject: string | undefined) => (
    <SpecialistUpdates
      key={group.key}
      group={group}
      {...(subject === undefined ? {} : { subject })}
    />
  );
  /** The decision card; `decide` lets the message it sits in look after focus as it settles. */
  const decisionCard = (
    approval: DocumentApproval,
    decide?: (decision: ToolApprovalDecision) => void,
  ) => {
    const countdown =
      typedYes !== undefined &&
      typedYes.held.approvalId === approval.approvalId &&
      approval.outcome === undefined ? (
        <TypedYesCountdown held={typedYes.held} onUndo={typedYes.onUndo} />
      ) : undefined;
    const choose = (choice: "yes" | "always" | "no") => {
      decide?.({
        outcome: choice === "no" ? "rejected" : "approved",
        scope: choice === "always" ? "always" : "once",
      });
      onDecide?.({ approvalId: approval.approvalId, choice });
    };
    return approval.packages ? (
      <PackageDecision
        approvalId={approval.approvalId}
        packages={approval.packages}
        {...(approval.outcome === undefined
          ? {}
          : { outcome: approval.outcome })}
        disabled={approvalDisabled}
        {...(approvalError === undefined ? {} : { error: approvalError })}
        onYes={() => choose("yes")}
        onAlways={() => choose("always")}
        onNo={() => choose("no")}
        countdown={countdown}
      />
    ) : (
      <DocumentDecision
        approval={approval}
        shownDocument={shownDocument}
        {...(onOpenDocument === undefined
          ? {}
          : { onShowDocument: onOpenDocument })}
        disabled={approvalDisabled}
        {...(approvalError === undefined ? {} : { error: approvalError })}
        onYes={() => choose("yes")}
        onAlways={() => choose("always")}
        onNo={() => {
          choose("no");
          onRequestChanges?.();
        }}
        countdown={countdown}
      />
    );
  };
  const renderApproval = (
    approval: DocumentApproval,
    position: string,
    headed: boolean,
  ) => (
    <ConversationItem
      key={approval.approvalId}
      itemId={`document-decision:${approval.at === undefined ? position : String(approval.at)}`}
    >
      <Message from="agent">
        {approval.packages ? (
          <MessageHeader name={wording.speaker.coder} />
        ) : headed ? null : (
          <MessageHeader name={wording.speaker.coordinator} />
        )}
        {decisionCard(approval)}
      </Message>
    </ConversationItem>
  );
  const renderMessage = (
    itemId: string,
    turn: TranscriptTurn,
    visible: readonly ConversationPart[],
    streaming: boolean,
  ) => (
    <ConversationItem key={itemId} itemId={itemId}>
      <Message
        from={turn.role === "person" ? "own" : "agent"}
        status={
          streaming ? "streaming" : turn.sending === true ? "sending" : "sent"
        }
      >
        <MessageHeader name={turnLabel(turn)} />
        <MessageParts
          parts={streaming ? visible : settledParts(visible)}
          streaming={streaming}
          renderText={renderTurnText}
          renderStep={renderStep}
          renderActivity={(steps, state) => {
            const label = state.streaming ? undefined : runLabel(steps);
            return (
              <Activity steps={steps} streaming={state.streaming}>
                <ActivityTrigger
                  {...(label === undefined ? {} : { label })}
                  labels={wording.activity.trigger}
                />
                <ActivityContent renderStep={renderStep} />
              </Activity>
            );
          }}
        />
        <MessageSendStatus />
        {turn.role === "assistant" && !streaming && wordsOf(visible) !== "" ? (
          <MessageFooter>
            <MessageActions aria-label={wording.message.actions}>
              <CopyAction text={wordsOf(visible)} />
            </MessageActions>
          </MessageFooter>
        ) : null}
      </Message>
    </ConversationItem>
  );
  const sections = threadSections(
    threadItems(turns, updates, approvals, runs, designChoice, results),
    results,
  );
  const mapTurns = sections.flatMap(
    (section, position): ConversationMapTurn[] => {
      if (section.kind !== "person" || section.turn.text.trim() === "")
        return [];
      const next = sections[position + 1];
      const reply =
        next?.kind === "coordinator"
          ? next.turns
              .map(({ turn }) => wordsOf(visibleTurnParts(turn)))
              .join(" ")
              .trim()
          : "";
      return [
        {
          id: turnItemId(section.turn, section.index),
          label:
            section.turn.text.length > MAP_LABEL_CHARS
              ? `${section.turn.text.slice(0, MAP_LABEL_CHARS).trimEnd()}…`
              : section.turn.text,
          ...(reply === "" ? {} : { preview: reply }),
        },
      ];
    },
  );
  return (
    <Conversation
      sentId={sentId}
      className="room-thread"
      data-mapped={mapTurns.length > 1 ? "" : undefined}
    >
      <ConversationContent
        aria-label={wording.conversation.label}
        className={CONV_SCROLL_CLASS}
      >
        {sections.map((section, position) => {
          if (section.kind === "coordinator") {
            // The person's next turn answers the stretch's questions; with none yet, only its last ask is open.
            const next = sections[position + 1];
            const reply = next?.kind === "person" ? next.turn.text : undefined;
            const lastAsk = section.cards.findLast(
              (card) => card.kind === "questions",
            );
            const questions = (callId: string): QuestionsState =>
              reply !== undefined
                ? { kind: "answered", reply }
                : lastAsk?.kind === "questions" && lastAsk.callId === callId
                  ? {
                      kind: "open",
                      disabled:
                        questionsDisabled || onAnswerQuestions === undefined,
                      onSend:
                        onAnswerQuestions ?? (() => Promise.resolve(false)),
                    }
                  : { kind: "replaced" };
            const first = section.turns[0];
            const visible = section.turns.flatMap(({ turn }) =>
              readableParts(visibleTurnParts(turn), results),
            );
            const headed = first !== undefined && visible.length > 0;
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
                {headed
                  ? renderMessage(
                      turnItemId(first.turn, first.index),
                      first.turn,
                      visible,
                      streaming,
                    )
                  : null}
                {foldUpdates(liveLast(section.cards, live)).map((card, at) =>
                  renderCard(
                    card,
                    `${String(position)}:${String(at)}`,
                    headed,
                    questions,
                  ),
                )}
              </Fragment>
            );
          }
          const { turn, index } = section;
          const itemId = turnItemId(turn, index);
          if (turn.text.startsWith(IMPORTED_PROJECT_LEAD))
            return (
              <ConversationItem key={itemId} itemId={itemId}>
                <ConversationDivider>
                  {wording.projectImported}
                </ConversationDivider>
              </ConversationItem>
            );
          if (turn.text.startsWith(SPECIALIST_ENDED_LEAD))
            return (
              <ConversationItem key={itemId} itemId={itemId}>
                <ConversationNotice>
                  <SpecialistEnded
                    text={turn.text.slice(SPECIALIST_ENDED_LEAD.length)}
                  />
                </ConversationNotice>
              </ConversationItem>
            );
          const visible = visibleTurnParts(turn);
          return visible.length === 0
            ? null
            : renderMessage(itemId, turn, visible, turn.streaming === true);
        })}
        {thinking ? (
          <ConversationItem itemId="colleague-thinking">
            <ThinkingIndicator label={wording.activity.thinkingNow} />
          </ConversationItem>
        ) : null}
        {children}
      </ConversationContent>
      <ConversationMap aria-label={wording.conversation.map} turns={mapTurns} />
      <ConversationScrollButton />
    </Conversation>
  );
}
