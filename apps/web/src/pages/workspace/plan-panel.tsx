/**
 * The project's plan beside the conversation: a narrow panel the person can resize by its left
 * edge and fold away. Where the room is narrow it is a drawer over the conversation instead.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { PanelRightClose } from "lucide-react";
import type { PlanView } from "@corbits-builder/schemas/project";
import { Button, Switch } from "@corbits/react-ui";
import {
  Steps,
  type StepFields,
  type StepItem,
  type StepState,
} from "@corbits-builder/plugin-ui/steps";
import { wording } from "../../config.ts";
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";
import styles from "./plan-panel.module.css";

const WIDTH_KEY = "builder-plan-width";
const COLLAPSED_KEY = "builder-plan-collapsed";
const MIN_WIDTH = 280;
const MAX_WIDTH = 440;
const DEFAULT_WIDTH = 320;
const KEY_STEP = 16;

type PlanStep = PlanView["steps"][number];

const clampWidth = (width: number) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

const parseWidth = (raw: string): string | null => {
  const width = Number(raw);
  return Number.isFinite(width) ? String(clampWidth(width)) : null;
};

const parseCollapsed = (raw: string): "yes" | "no" | null =>
  raw === "yes" || raw === "no" ? raw : null;

/** Whether the plan is folded away on a wide room, and the control that changes it. */
export function usePlanCollapsed(): readonly [
  boolean,
  (collapsed: boolean) => void,
] {
  const collapsed = useStoredPreference(COLLAPSED_KEY, parseCollapsed, "no");
  return [
    collapsed === "yes",
    (next) => writeStoredPreference(COLLAPSED_KEY, next ? "yes" : "no"),
  ];
}

type PlanChild = Exclude<PlanStep, { steps: unknown }>;

/** Where a step stands, as the plan's button marks it. */
export type PlanMark = "done" | "failed" | "needs_you" | "running" | "open";

function markOf(step: PlanChild): PlanMark {
  if (
    step.state === "done" ||
    step.state === "failed" ||
    step.state === "needs_you" ||
    step.state === "running"
  )
    return step.state;
  return "open";
}

// A skipped or cancelled step will not happen, so it is neither done nor still to do.
const dropped = (step: PlanChild) =>
  step.state === "skipped" || step.state === "cancelled";

const actionSteps = (steps: readonly PlanStep[]): PlanChild[] =>
  steps.flatMap((step) => ("steps" in step ? step.steps : [step]));

/**
 * How far along the plan is, over the steps the panel lists (a group's steps, not the group): a
 * mark per step still in play, how many are done, and the step state that should draw the person
 * to the plan (a failure before a step waiting on them), or null while the plan has no steps.
 */
export function planProgress(steps: readonly PlanStep[]) {
  if (steps.length === 0) return null;
  const counted = actionSteps(steps).filter((step) => !dropped(step));
  const marks = counted.map((step) => ({ id: step.id, mark: markOf(step) }));
  const has = (mark: PlanMark) => marks.some((each) => each.mark === mark);
  const alerts = ["failed", "needs_you"] as const;
  return {
    marks,
    done: marks.filter((each) => each.mark === "done").length,
    total: marks.length,
    alert: alerts.find(has) ?? null,
  };
}

/**
 * Where a group stands, from its steps: a failure or a step waiting on the person first, then
 * done once every step is done or will not happen, not started while none has begun, and
 * otherwise under way.
 */
export function groupState(steps: readonly PlanChild[]): StepState {
  const states = steps.filter((step) => !dropped(step)).map(markOf);
  if (states.includes("failed")) return "failed";
  if (states.includes("needs_you")) return "needs_you";
  if (states.every((state) => state === "done")) return "done";
  if (states.every((state) => state === "open")) return "not_started";
  return "running";
}

/**
 * The plan as the panel lists it. A ready-made plan's group carries only the plan's long
 * description as its title, so its steps stand on their own under the panel's heading; any other
 * group keeps its title, with where it stands worked out from its steps.
 */
export function panelSteps(steps: readonly PlanStep[]): StepItem[] {
  return steps.flatMap((step): StepItem[] => {
    if (!("steps" in step)) return [step];
    if (step.plan !== undefined) return step.steps;
    return [
      {
        id: step.id,
        title: step.title,
        state: groupState(step.steps),
        steps: step.steps,
      },
    ];
  });
}

function hasRunningClock(steps: readonly PlanStep[]) {
  const running = (step: StepFields) =>
    step.state === "running" && step.startedAt !== undefined;
  return steps.some((step) =>
    "steps" in step ? step.steps.some(running) : running(step),
  );
}

function stepNote(step: StepFields) {
  const words = wording.conversation.plan;
  const notes = [
    step.optional === true ? words.optional : undefined,
    step.approval?.when === "required" ? words.approvalRequired : undefined,
    step.approval?.when === "optional" ? words.approvalOffered : undefined,
  ].filter((note) => note !== undefined);
  return notes.length === 0 ? undefined : notes.join(" · ");
}

/**
 * A step's switches, "ask me first" and, on an optional step, "skip", and the go-ahead a step waits
 * on; nothing once the step can no longer change.
 */
export function StepControls({
  step,
  busy,
  onAskFirst,
  onDecline,
  onGoAhead,
}: {
  step: PlanChild;
  /** This step's change is on its way to the room, so it holds until that lands. */
  busy: boolean;
  onAskFirst: (askFirst: boolean) => void;
  onDecline: (declined: boolean) => void;
  onGoAhead: () => void;
}) {
  const words = wording.conversation.plan;
  const declined = step.declined !== undefined;
  const waitingOnGo =
    step.askFirst && step.goAhead === undefined && step.state === "needs_you";
  const mayAsk =
    !declined &&
    step.cancelled === undefined &&
    (step.state === "waiting" ||
      step.state === "not_started" ||
      step.state === "needs_you");
  const mayDecline =
    declined ||
    (step.optional === true &&
      step.state !== "done" &&
      step.state !== "running");
  if (!waitingOnGo && !mayAsk && !mayDecline) return null;
  // "Ask me first" stays on a skipped step, switched off, so skipping does not change the row's
  // height.
  return (
    <div className={styles.controls}>
      <label className={styles.setting}>
        <Switch
          checked={step.askFirst}
          label={words.forStep(words.askFirst, step.title)}
          disabled={!mayAsk || busy}
          onCheckedChange={onAskFirst}
        />
        {words.askFirst}
      </label>
      {mayDecline ? (
        <label className={styles.setting}>
          <Switch
            checked={declined}
            label={words.forStep(words.skip, step.title)}
            disabled={busy}
            onCheckedChange={onDecline}
          />
          {words.skip}
        </label>
      ) : null}
      {waitingOnGo ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={styles.goAhead}
          aria-label={words.forStep(words.goAhead, step.title)}
          disabled={busy}
          onClick={onGoAhead}
        >
          {words.goAhead}
        </Button>
      ) : null}
    </div>
  );
}

export function PlanPanel({
  steps,
  drawer,
  onHide,
  onDecline,
  onGoAhead,
  onAskFirst,
}: {
  steps: readonly PlanStep[];
  /** The room is narrow, so the panel lies over the conversation. */
  drawer: boolean;
  onHide: () => void;
  /** Declines an optional step, or brings a declined one back; resolves once the room has it. */
  onDecline: (stepId: string, declined: boolean) => Promise<void>;
  /** Gives the go-ahead on a step the person asked to be consulted on; resolves once the room has it. */
  onGoAhead: (stepId: string) => Promise<void>;
  /** Turns "ask me first" on or off for a step; resolves once the room has it. */
  onAskFirst: (stepId: string, askFirst: boolean) => Promise<void>;
}) {
  const [changing, setChanging] = useState<string | null>(null);
  const stored = Number(
    useStoredPreference(WIDTH_KEY, parseWidth, String(DEFAULT_WIDTH)),
  );
  const [dragging, setDragging] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const width = dragging ?? stored;
  const [now, setNow] = useState(() => Date.now());
  const ticking = hasRunningClock(steps);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);
  const change = async (stepId: string, send: () => Promise<void>) => {
    setChanging(stepId);
    try {
      await send();
    } finally {
      setChanging(null);
    }
  };
  const stepAction = (step: StepFields) => {
    const saved = actionSteps(steps).find(({ id }) => id === step.id);
    if (saved === undefined) return null;
    return (
      <StepControls
        step={saved}
        busy={changing === step.id}
        onAskFirst={(askFirst) =>
          void change(step.id, () => onAskFirst(step.id, askFirst))
        }
        onDecline={(declined) =>
          void change(step.id, () => onDecline(step.id, declined))
        }
        onGoAhead={() => void change(step.id, () => onGoAhead(step.id))}
      />
    );
  };
  const dragTo = (event: PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (panel === null) return;
    setDragging(
      clampWidth(panel.getBoundingClientRect().right - event.clientX),
    );
  };
  const endDrag = () => {
    if (dragging !== null) writeStoredPreference(WIDTH_KEY, String(dragging));
    setDragging(null);
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const by = event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP;
    writeStoredPreference(WIDTH_KEY, String(clampWidth(width + by)));
  };
  return (
    <aside
      ref={panelRef}
      className={styles.plan}
      data-slot="room-plan"
      data-drawer={drawer ? "" : undefined}
      style={{ width }}
      aria-label={wording.conversation.plan.title}
    >
      {drawer ? null : (
        <div
          className={styles.handle}
          role="separator"
          aria-orientation="vertical"
          aria-label={wording.conversation.plan.resize}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={(event) =>
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              dragTo(event);
          }}
          onPointerUp={endDrag}
          onPointerCancel={() => setDragging(null)}
          onKeyDown={nudge}
        />
      )}
      <header className={styles.header}>
        <h2 className={styles.title}>{wording.conversation.plan.title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={wording.conversation.plan.hide}
          title={wording.conversation.plan.hide}
          onClick={onHide}
        >
          <PanelRightClose aria-hidden="true" />
        </Button>
      </header>
      <div className={styles.body}>
        <Steps
          steps={panelSteps(steps)}
          label={wording.conversation.plan.steps}
          now={ticking ? now : undefined}
          note={stepNote}
          action={stepAction}
        />
      </div>
    </aside>
  );
}
