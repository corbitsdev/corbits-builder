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
import type { StoredPlanStep } from "@corbits-builder/schemas/project";
import { Button } from "@corbits/react-ui";
import { Steps } from "@corbits-builder/plugin-ui/steps";
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

/** How many of the top-level steps are done, or null while no step says where it stands. */
export function planProgress(steps: readonly StoredPlanStep[]) {
  const marked = steps.filter((step) => "state" in step);
  if (marked.length === 0) return null;
  return {
    done: steps.filter((step) => "state" in step && step.state === "done")
      .length,
    total: steps.length,
  };
}

function hasRunningClock(steps: readonly StoredPlanStep[]) {
  return steps.some(
    (step) =>
      ("state" in step && step.state === "running" && "startedAt" in step) ||
      (step.steps ?? []).some(
        (child) =>
          "state" in child && child.state === "running" && "startedAt" in child,
      ),
  );
}

export function PlanPanel({
  steps,
  drawer,
  onHide,
}: {
  steps: readonly StoredPlanStep[];
  /** The room is narrow, so the panel lies over the conversation. */
  drawer: boolean;
  onHide: () => void;
}) {
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
          steps={steps}
          label={wording.conversation.plan.steps}
          now={ticking ? now : undefined}
        />
      </div>
    </aside>
  );
}
