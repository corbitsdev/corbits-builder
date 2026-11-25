/**
 * The project's plan as the coordinator saved it: each step a stop on a timeline, opening what it
 * made once it is made. It is a tree of one level with a single tab stop, after the WAI-ARIA tree
 * view pattern: the arrows move between steps, Home and End jump, a letter finds the next step
 * starting with it, and Enter or Space opens what a step made.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { wording } from "../../config.ts";
import { clock, useElapsedMs } from "./elapsed.tsx";
import rowStyles from "./sidebar-row.module.css";
import styles from "./plan-timeline.module.css";

const words = wording.projectShell;

/** Where a step of the plan stands, as its row marks it. */
export type SidebarStepState =
  | "to_do"
  | "running"
  | "needs_you"
  | "done"
  | "failed"
  | "declined";

export type SidebarStep = {
  id: string;
  name: string;
  state: SidebarStepState;
  /** Builder asks before it starts the step; null once that can no longer change. */
  askFirst: boolean | null;
  /** The person declined the step; null where it cannot be declined. */
  declined: boolean | null;
};

/** One step of the plan. A step that makes nothing is listed as much as one that makes something. */
export type SidebarRow = {
  id: string;
  name: string;
  state: SidebarStepState;
  /** It makes the project's app: once built it opens the app and says how it runs. */
  app: boolean;
  /** The tab of what it made, which the row opens; null while there is nothing to show. */
  opens: string | null;
  /** When the step started, so a running one counts up from it; null before it has. */
  startedAt: string | null;
  /** The run's last activity, or why it failed; null while it has said none. */
  summary: string | null;
  /** The steps the row covers; the next one to do says whether Builder pauses before it. */
  steps: readonly SidebarStep[];
};

/** How the project's app stands, as the step that makes it says. */
export type SidebarAppState =
  | "not_built"
  | "starting"
  | "running"
  | "stopped"
  | "failed";

export type PlanTimelineProps = {
  plan: readonly SidebarRow[];
  app: SidebarAppState;
  /** The tab opened from the plan, whose step is marked; null while none is. */
  shown: string | null;
  /**
   * The document opened from what waits in the prompt box, while it still waits: its step says it
   * waits on the person. Null while nothing was opened that way.
   */
  waitsOn: string | null;
  /** Opens what a step made, on its tab. */
  onOpenStep: (tab: string) => void;
};

/** What every step takes to hold the tree's one tab stop. */
type StepItemProps = Required<
  Pick<ComponentProps<"li">, "ref" | "tabIndex" | "onFocus">
>;

export function PlanTimeline({
  plan,
  app,
  shown,
  waitsOn,
  onOpenStep,
}: PlanTimelineProps) {
  const headingId = `plan-${useId()}`;
  const opener = ({ opens }: SidebarRow) =>
    opens === null ? null : () => onOpenStep(opens);
  const items = useRef(new Map<string, HTMLElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // Tab enters at the step last focused, else the first.
  const tabStop =
    focused !== null && plan.some((row) => row.id === focused)
      ? focused
      : plan[0]?.id;
  const focus = (id: string) => {
    setFocused(id);
    items.current.get(id)?.focus();
  };
  // Where the project is: the step at work or waiting on the person, else the last one done. When
  // the plan is taller than the room it has, that step stays in sight as it changes and as the
  // room grows or shrinks, rather than the first steps.
  const here =
    plan.find(
      (row) =>
        row.state === "running" ||
        row.state === "needs_you" ||
        (row.opens !== null && row.opens === waitsOn),
    ) ?? plan.findLast((row) => row.state === "done");
  const hereId = here?.id ?? null;
  useEffect(() => {
    const step = hereId === null ? undefined : items.current.get(hereId);
    const scroller = step === undefined ? null : scrollerOf(step);
    if (step === undefined || scroller === null) return;
    const show = () => {
      const box = scroller.getBoundingClientRect();
      const at = step.getBoundingClientRect();
      if (at.top < box.top) scroller.scrollTop -= box.top - at.top;
      else if (at.bottom > box.bottom)
        scroller.scrollTop += at.bottom - box.bottom;
    };
    show();
    const resized = new ResizeObserver(show);
    resized.observe(scroller);
    return () => resized.disconnect();
  }, [hereId]);
  // With no plan yet, the place the steps will take says so, rather than standing empty.
  if (plan.length === 0)
    return (
      <section className={styles.plan}>
        <h2 className={styles.head}>{words.plan}</h2>
        <p className={styles.empty}>{words.noPlan}</p>
      </section>
    );
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // The step the key was pressed on, which is the tab stop unless focus got there unannounced.
    const on =
      [...items.current].find(([, element]) => element === event.target)?.[0] ??
      tabStop;
    const index = plan.findIndex((row) => row.id === on);
    const row = plan[index];
    if (row === undefined || event.altKey || event.metaKey || event.ctrlKey)
      return;
    const move = (to: SidebarRow | undefined) => {
      if (to !== undefined) focus(to.id);
    };
    switch (event.key) {
      case "ArrowDown":
        move(plan[index + 1]);
        break;
      case "ArrowUp":
        move(plan[index - 1]);
        break;
      case "Home":
        move(plan[0]);
        break;
      case "End":
        move(plan.at(-1));
        break;
      case "Enter":
      case " ":
        opener(row)?.();
        break;
      default: {
        if (event.key.length !== 1) return;
        const letter = event.key.toLowerCase();
        const after = [...plan.slice(index + 1), ...plan.slice(0, index + 1)];
        const found = after.find((each) =>
          each.name.toLowerCase().startsWith(letter),
        );
        if (found === undefined) return;
        focus(found.id);
      }
    }
    event.preventDefault();
  };
  const itemProps = (id: string): StepItemProps => ({
    ref: (element) => {
      if (element === null) items.current.delete(id);
      else items.current.set(id, element);
    },
    tabIndex: id === tabStop ? 0 : -1,
    onFocus: (event) => {
      if (event.target === event.currentTarget) setFocused(id);
    },
  });
  return (
    <section className={styles.plan}>
      <h2 id={headingId} className={styles.head}>
        {words.plan}
      </h2>
      <ul
        role="tree"
        aria-labelledby={headingId}
        className={styles.tree}
        onKeyDown={onKeyDown}
      >
        {plan.map((row) => (
          <PlanRow
            key={row.id}
            row={row}
            app={row.app ? app : null}
            current={row.opens !== null && row.opens === shown}
            waits={row.opens !== null && row.opens === waitsOn}
            onOpen={opener(row)}
            {...itemProps(row.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One step of the plan, as a stop on a timeline: a circle on the line that joins the steps, and the
 * step's name beside it. Only the step at work, one that waits on the person, one that was skipped
 * and the app's own step have a line under the name: how long it has run, that it waits, that it
 * was skipped, or how the app runs. A step whose work stopped is not shown as an error: it waits on
 * the person to try again, so it is drawn as one that waits, and only its name for a screen reader
 * says it stopped. The one whose document is on the page is shaded. What a run last did is often a
 * tool's own words, so it is kept to the row's tooltip. Once a step has made something it opens it.
 */
function PlanRow({
  row,
  app,
  current,
  waits,
  onOpen,
  ...item
}: {
  row: SidebarRow;
  /** How the app stands, on the row that makes it; null on every other. */
  app: SidebarAppState | null;
  /** What it made is on the page. */
  current: boolean;
  /** What waits in the prompt box opened what it made, so it waits on the person too. */
  waits: boolean;
  /** Opens what it made; null while there is nothing to show. */
  onOpen: (() => void) | null;
} & StepItemProps) {
  const stopped = row.state === "failed";
  const state = waits || stopped ? "needs_you" : row.state;
  const next = row.steps.find(
    (step) => step.state === "to_do" && step.declined !== true,
  );
  const pauses = state === "to_do" && next?.askFirst === true;
  const live = state === "done" && app !== null && app !== "not_built";
  const doing = live ? words.appNow[app] : null;
  const said = [
    row.name,
    ...(stopped ? [words.stepState.failed] : []),
    state === "declined" ? words.skipped : words.stepState[state],
    ...(doing === null ? [] : [doing]),
    ...(pauses ? [words.pausesFirst] : []),
  ].join(", ");
  const line =
    state === "running" ? (
      <span className={styles.doing}>
        {words.stepNow.working}
        <span aria-hidden="true">·</span>
        <RunningFor since={row.startedAt} />
      </span>
    ) : state === "needs_you" ? (
      <span className={styles.doing} data-tone="you">
        {words.stepNow.needsYou}
      </span>
    ) : state === "declined" ? (
      <span className={styles.doing}>{words.stepNow.skipped}</span>
    ) : doing === null ? null : (
      <span className={styles.doing} aria-live="polite">
        {doing}
      </span>
    );
  return (
    <li
      role="treeitem"
      aria-level={1}
      aria-label={said}
      aria-current={current ? "page" : undefined}
      className={`${rowStyles.row} ${styles.step}`}
      data-state={state}
      data-opens={onOpen === null ? undefined : ""}
      title={row.summary === null ? row.name : `${row.name}: ${row.summary}`}
      onClick={onOpen ?? undefined}
      {...item}
    >
      <span className={styles.circle} />
      <span className={styles.text}>
        <span className={rowStyles.name}>{row.name}</span>
        {line}
      </span>
    </li>
  );
}

/** The nearest box around the element that scrolls; null when none does. */
function scrollerOf(element: HTMLElement) {
  for (let box = element.parentElement; box !== null; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box);
    if (overflowY === "auto" || overflowY === "scroll") return box;
  }
  return null;
}

/** How long a step has run, as a clock that counts up each second. */
function RunningFor({ since }: { since: string | null }) {
  const seconds = Math.floor(useElapsedMs(since) / 1000);
  return <span className={styles.clock}>{clock(seconds)}</span>;
}
