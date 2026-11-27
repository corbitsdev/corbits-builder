/**
 * A question the coordinator asked as a plugin's screen. The plugin, not the agent, decides what is
 * drawn: its view gets the project's values it reads, the checked input and the draft. Its output
 * answers the question through the hub, which saves the values it writes and records what it approves.
 * What the person has chosen so far is kept across a reload as the question card keeps its answers.
 */
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { useQuestionOutcome } from "./question-outcome.tsx";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { type, type ArkErrors, type Type } from "arktype";
import {
  validateInput,
  validateOutput,
  type Decision,
  type Offer,
  type ProjectValues,
  type Screen,
  type ScreenActionBuilder,
} from "@corbits-builder/plugin";
import { QuestionAnswer } from "@corbits-builder/schemas/conversation";
import {
  ActionsSlot,
  PromptAction,
  ScreenDecision,
  ScreenRow,
  usePromptPlaceholder,
  usePromptSend,
  type DecisionControls,
  type PromptTake,
} from "@corbits-builder/plugin-ui/screen-actions";
import { SettledFrame } from "@corbits-builder/plugin-ui/screen-card";
import { wording } from "../../config.ts";
import { Fault, InlineNote } from "../../components.jsx";
import type { DesignFiles } from "./design-bundle.ts";
import type { ReviewedDesign } from "./design-concept.ts";
import { CommentCard, type CommentCardProps } from "./comment-card.tsx";
import { MockupFrame, type MockupFrameProps } from "./mockup-frame.tsx";
import { SettledReply, useAnswer } from "./questions-card.tsx";
import styles from "./screen-question.module.css";

const text = wording.questions;

// The project's facts, which gate options such as paid fonts. None reach the interface yet.
export const projectFacts: readonly string[] = [];

/** Reads the open project's values by name. */
export type ProjectValuesStore = {
  read(keys: readonly string[], signal: AbortSignal): Promise<ProjectValues>;
};

/** A filed document at its current version, as a screen lists it to approve. */
export type ShownDocument = {
  kind: string;
  title: string;
  artifactId: string;
  version: number;
  approvedVersion?: number;
  /** The document's own `## In short` section, as markdown, when it has one. */
  summary?: string;
};

/** What the room works out and supplies a screen's view, by the names a manifest lists under host. */
export type HostSupplies = {
  /** The live draft while a designer works, else the newest filed design or design option. */
  design: ReviewedDesign | null;
  /** The output of the latest question the coordinator asked with the same screen, if answered. */
  earlierAnswer: unknown;
  /** The project's filed documents, and a way to open one over the room by its kind. */
  documents: { list: readonly ShownDocument[]; open(kind: string): void };
  /** The filed design concepts the person has yet to choose between, in the order they were asked about. */
  designConcepts: readonly ChoosableConcept[];
  /** The room's prompt box, as a screen's decision sees it. Only the host reads it, never a view. */
  reply: ReplyBox;
  /** The project's and its workspace's tenants, where a credential is saved; null until both are read. */
  tenants: Tenants | null;
  /**
   * What the hub prepared for the screen of the question by this signal, for a screen that
   * prepares from the project; undefined until the hub has read it.
   */
  asked: (signalName: string) => unknown;
};

export type Tenants = { project: string; workspace: string };

export type ViewResources = {
  design: HostSupplies["design"];
  /** A design bundle drawn in the design pane's own sandboxed frame. */
  mockupFrame: ComponentType<MockupFrameProps>;
  /** The card a comment is written and kept in on the project's pages. */
  commentCard: ComponentType<CommentCardProps>;
  earlierAnswer: unknown;
  documents: { list: readonly ShownDocument[] };
  designConcepts: readonly ChoosableConcept[];
  tenants: Tenants;
};

/** The room's prompt box, as a screen's decision sees it. */
export type ReplyBox = {
  /** The box holds more than whitespace. */
  drafted: boolean;
};

/**
 * Send in the prompt box while a decision has feedback pending. It sends the feedback, with any
 * typed words as a note, and its label names the feedback. With no words and no feedback there's
 * nothing to send.
 */
function sendBackOffer(
  staging: boolean,
  pending: string | null,
  sendBack: { current: (message: string | undefined) => Promise<boolean> },
): {
  take: PromptTake | undefined;
  label: string | null;
  placeholder: string | undefined;
} {
  if (!staging) return { take: undefined, label: null, placeholder: undefined };
  return {
    take: (words) =>
      words === "" && pending === null
        ? false
        : sendBack.current(words === "" ? undefined : words),
    label: pending === null ? null : text.sendBack(pending),
    placeholder: pending === null ? undefined : text.sendBackReply(pending),
  };
}

/** A filed design concept, and the design option choosing it approves, if any. */
export type ChoosableConcept = {
  label: string;
  direction: string | undefined;
  files: DesignFiles;
  version: number;
  approval: ReviewedDesign["approval"];
};

const SUPPLIED: ReadonlySet<string> = new Set<keyof ViewResources>([
  "design",
  "mockupFrame",
  "commentCard",
  "earlierAnswer",
  "documents",
  "designConcepts",
  "tenants",
]);

/** The pending items an offer would send back, in the decision's words; null while there are none. */
export function pendingItems<Out>(
  decision: Decision<Out>,
  sendBack: Out | undefined,
): string | null {
  if (
    decision.sendBack === undefined ||
    sendBack === undefined ||
    sendBack === null
  )
    return null;
  const { items, one, many } = decision.sendBack;
  const held = sendBack[items];
  const count = Array.isArray(held) ? held.length : 0;
  if (count === 0) return null;
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

/** The controls a screen's decision gets from what its view offers and the prompt box holds. */
export function decisionControls<Out>(
  decision: Decision<Out>,
  offer: Offer<Out> | undefined,
  room: { drafted: boolean; accept: (output: Out) => void },
): DecisionControls {
  const accept = offer?.accept;
  const accepted =
    accept !== undefined && "output" in accept ? accept.output : undefined;
  return {
    accept: decision.accept,
    onAccept: accepted === undefined ? null : () => room.accept(accepted),
    unavailable:
      accept !== undefined && "unavailable" in accept
        ? accept.unavailable
        : undefined,
    pending: pendingItems(decision, offer?.sendBack),
    drafted: room.drafted,
  };
}

/** The answer sending back gives: the offered output, with the typed note in the decision's field. */
export function sentBack<Out>(
  note: string,
  sendBack: Out,
  message: string | undefined,
): Out {
  if (message === undefined) return sendBack;
  return Object.assign({}, sendBack, { [note]: message });
}

// Draft text may be unfinished; output validation still gates every submission.
const isDraft = <Out,>(
  saved: unknown,
  errors: ArkErrors,
): saved is Partial<Out> =>
  typeof saved === "object" &&
  saved !== null &&
  !Array.isArray(saved) &&
  errors.every(
    (error) =>
      (error.code === "required" && error.path.length === 1) ||
      error.code === "pattern" ||
      error.code === "minLength",
  );

/** What the person chose so far, read back through the screen's own output schema; undefined if it does not fit. */
export const draftOf =
  <Out,>(output: Type<Out>) =>
  (saved: unknown): Partial<Type<Out>["infer"]> | undefined => {
    const checked = output(saved);
    if (!(checked instanceof type.errors)) return checked;
    return isDraft<Type<Out>["infer"]>(saved, checked) ? saved : undefined;
  };

export type ScreenHostProps = {
  /** The question's signal, which keys what the person has chosen so far. */
  signalName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | undefined;
  projectValues: ProjectValuesStore;
  disabled: boolean;
  onAnswer: (answer: QuestionAnswer) => Promise<boolean>;
  host: HostSupplies;
};

/** One plugin's screen action, by its name such as "designer pick-fonts", typed end to end, behind props every screen shares. */
export function screenHost<In, Out, Data, Prepared>(
  handle: string,
  builder: ScreenActionBuilder,
  plugin: {
    screen: Screen<In, Out, Data, Prepared>;
    view: ComponentType<
      ScreenViewProps<
        Type<In>["infer"],
        Type<Out>["infer"],
        Prepared,
        ViewResources
      >
    >;
    data: Type<Data>["infer"];
  },
): ComponentType<ScreenHostProps> {
  const { screen, view: View, data } = plugin;
  const readDraft = draftOf(screen.output);
  const { reads = [], host: supplied = [] } = builder;
  const unknown = supplied.find((name) => !SUPPLIED.has(name));
  if (unknown !== undefined)
    throw new Error(
      `${handle} asks for ${unknown}, which this interface does not supply.`,
    );

  return function ScreenHost({
    signalName,
    input,
    output,
    projectValues,
    disabled,
    onAnswer,
    host,
  }) {
    const outcome = useQuestionOutcome(signalName);
    const slot = useContext(ActionsSlot);
    const action = useContext(PromptAction);
    const [project, setProject] = useState<ProjectValues>();
    const [unreadable, setUnreadable] = useState(false);
    const answering = useAnswer(
      `unsent:screen:${signalName}`,
      readDraft,
      onAnswer,
    );
    const [offer, setOffer] = useState<Offer<Type<Out>["infer"]>>();
    const settled = output !== undefined;
    const busy = answering.sending || outcome?.kind === "sending" || disabled;
    const { decision } = screen;
    const pending =
      decision === undefined ? null : pendingItems(decision, offer?.sendBack);
    // The prompt box sends the feedback back only where the decision sends it back as output.
    const staging =
      !settled &&
      decision?.sendBack !== undefined &&
      offer?.sendBack !== undefined;
    const sendBack = useRef<(message: string | undefined) => Promise<boolean>>(
      () => Promise.resolve(false),
    );
    const back = sendBackOffer(staging, pending, sendBack);
    usePromptSend(back.take, back.label);
    usePromptPlaceholder(back.placeholder);

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
    const { tenants } = host;
    if (shown === undefined || tenants === null) return <ScreenLoading />;
    const checked = validateInput(handle, screen, input, data, shown);
    const answered =
      output === undefined ? undefined : validateOutput(handle, screen, output);
    if (!checked.ok || answered?.ok === false)
      return <InlineNote>{text.screenUnavailable}</InlineNote>;
    // A screen that prepares from the project draws once the hub's read of the plan brings it.
    const prepared =
      screen.fromProject === undefined
        ? checked.prepared
        : (host.asked(signalName) as Prepared | undefined);
    if (prepared === undefined)
      return screen.fromProject === undefined ? (
        <InlineNote>{text.screenUnavailable}</InlineNote>
      ) : (
        <ScreenLoading />
      );

    const answerWith = (chosen: Type<Out>["infer"]) => {
      const result = validateOutput(handle, screen, chosen);
      if (!result.ok) throw new Error(result.text);
      return answering.send(QuestionAnswer.assert({ output: result.output }));
    };
    const submit = async (chosen: Type<Out>["infer"]) => {
      await answerWith(chosen);
    };
    const note = decision?.sendBack?.note;
    const offered = offer?.sendBack;
    if (note !== undefined && offered !== undefined)
      sendBack.current = (message) =>
        answerWith(sentBack(note, offered, message));
    const view = (
      <View
        prepared={{
          input: checked.input,
          data: prepared,
          project: shown,
          facts: projectFacts,
          resources: {
            design: host.design,
            mockupFrame: MockupFrame,
            commentCard: CommentCard,
            earlierAnswer: host.earlierAnswer,
            documents: { list: host.documents.list },
            designConcepts: host.designConcepts,
            tenants,
          },
        }}
        draft={answering.draft ?? {}}
        setDraft={(change) =>
          answering.change((current) => {
            const draft: Partial<Type<Out>["infer"]> =
              current === undefined ? {} : current;
            return Object.assign(
              {},
              draft,
              typeof change === "function" ? change(draft) : change,
            );
          })
        }
        submit={submit}
        submitting={busy}
        answer={answered?.output}
        place="card"
        fault={
          outcome !== undefined && "fault" in outcome
            ? outcome.fault
            : undefined
        }
        openDocument={
          supplied.includes("documents") ? host.documents.open : undefined
        }
        offer={setOffer}
      />
    );
    if (settled)
      return (
        <SettledFrame
          title={text.screenAnswered}
          untitled
          ended="answered"
          focus={answering.sending}
        >
          {view}
        </SettledFrame>
      );
    // Buttons drawn elsewhere, such as in the prompt box, leave the screen's inert hold, so they
    // take it again there.
    const held = (place: ((buttons: ReactNode) => ReactNode) | null) =>
      place === null
        ? null
        : (buttons: ReactNode) =>
            place(
              <div className={styles.screen} inert={busy}>
                {buttons}
              </div>,
            );
    return (
      <ScreenRow
        value={{
          // In the prompt box the person's own words are the way out, so there is no Cancel.
          cancel:
            slot === null
              ? {
                  label: text.cancel,
                  onCancel: () =>
                    void answering.send({ reply: text.cancelReply }),
                }
              : null,
          fault:
            outcome !== undefined && "fault" in outcome ? (
              <Fault>{outcome.fault}</Fault>
            ) : null,
          back: null,
        }}
      >
        <ActionsSlot value={held(slot)}>
          <PromptAction value={held(action)}>
            <ScreenDecision
              value={
                decision === undefined
                  ? null
                  : decisionControls(decision, offer, {
                      drafted: host.reply.drafted,
                      accept: (chosen) => void submit(chosen),
                    })
              }
            >
              {/* While an answer is on its way the whole screen takes no input, whatever it draws. */}
              <div className={styles.screen} inert={busy}>
                {view}
              </div>
            </ScreenDecision>
          </PromptAction>
        </ActionsSlot>
      </ScreenRow>
    );
  };
}

export type ListedHostProps = {
  state: unknown;
  act: (
    plugin: string,
    action: string,
    input: Record<string, unknown>,
  ) => Promise<string | undefined>;
  host: HostSupplies;
};

/**
 * Placeholder rows at a screen card's inset, so the box opens near the card's size before the view
 * loads. The heading is a row too, because some screens word it from the data being loaded.
 */
function ScreenLoading() {
  return (
    <div
      className={styles.loading}
      data-slot="screen-loading"
      role="status"
      aria-label={text.screenLoading}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

type Click =
  | { is: "idle" }
  | { is: "acting" }
  | { is: "failed"; reason: string };

export function listedHost(
  name: string,
  plugin: string,
  View: ComponentType<
    ScreenViewProps<unknown, unknown, unknown, ViewResources>
  >,
): ComponentType<ListedHostProps> {
  return function ListedHost({ state, act, host }) {
    const [click, setClick] = useState<Click>({ is: "idle" });
    const [draft, setDraft] = useState({});
    const { tenants } = host;
    if (tenants === null) return <ScreenLoading />;
    const run = async (action: string, input: Record<string, unknown> = {}) => {
      setClick({ is: "acting" });
      const reason = await act(plugin, action, input);
      setClick(
        reason === undefined ? { is: "idle" } : { is: "failed", reason },
      );
    };
    return (
      <View
        prepared={{
          input: {},
          data: state,
          project: {},
          facts: projectFacts,
          resources: {
            design: host.design,
            mockupFrame: MockupFrame,
            commentCard: CommentCard,
            earlierAnswer: undefined,
            documents: { list: host.documents.list },
            designConcepts: host.designConcepts,
            tenants,
          },
        }}
        draft={draft}
        setDraft={(change) =>
          setDraft((current) =>
            typeof change === "function" ? change(current) : change,
          )
        }
        submit={async () => {
          throw new Error(`${name} answers no question.`);
        }}
        submitting={click.is === "acting"}
        answer={undefined}
        place="card"
        fault={click.is === "failed" ? click.reason : undefined}
        act={run}
      />
    );
  };
}

export type ScreenQuestionProps = {
  signalName: string;
  host: ComponentType<ScreenHostProps> | undefined;
  input: Record<string, unknown>;
  projectValues: ProjectValuesStore | undefined;
  answer: QuestionAnswer | undefined;
  disabled: boolean;
  onAnswer: ScreenHostProps["onAnswer"];
  supplies: HostSupplies | undefined;
};

/** The screen, or a plain notice when it has no view or no project to read. */
export function ScreenQuestion({
  signalName,
  host: Host,
  input,
  projectValues,
  answer,
  disabled,
  onAnswer,
  supplies,
}: ScreenQuestionProps) {
  if (answer !== undefined && "reply" in answer)
    return <SettledReply reply={answer.reply} sent={false} />;
  if (
    Host === undefined ||
    projectValues === undefined ||
    supplies === undefined
  )
    return (
      <SettledFrame title={text.title(1)} ended="waiting">
        <p>{text.screenUnavailable}</p>
      </SettledFrame>
    );
  return (
    <Host
      signalName={signalName}
      input={input}
      output={
        answer !== undefined && "output" in answer ? answer.output : undefined
      }
      projectValues={projectValues}
      disabled={disabled}
      onAnswer={onAnswer}
      host={supplies}
    />
  );
}
