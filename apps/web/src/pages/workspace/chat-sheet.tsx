/**
 * The chat behind the prompt box. A pull handle sits on the box's top edge; dragging it up, or
 * pressing it, grows a sheet up around the box holding the conversation. Pulling it down, or
 * Escape, puts it back. Over the project, where the conversation is out of sight, the status pill
 * says what is running and opens the chat in the handle's place; where the conversation is the
 * page, its own thinking says that, so only a pill with something to press, such as Open on a
 * document that is ready, stands above the box, with the handle beneath.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { ArrowDown, Maximize2 } from "lucide-react";
import { wording } from "../../config.ts";
import { StatusPill, type StatusPillContent } from "./status-pill.tsx";
import styles from "./chat-sheet.module.css";

const copy = wording.promptBox;

/** How far a slow pull has to travel before letting go leaves the chat open. */
const OPENS_AT_PX = 48;
/** A flick this fast, in pixels per millisecond, settles the way it was going however short it was. */
const FLICK_PX_PER_MS = 0.11;
/** A flick's speed is taken over this many milliseconds of the pull, not from one jittery pair of moves. */
const FLICK_WINDOW_MS = 80;
/** Less movement than this is a press, not a pull. */
const PRESS_PX = 4;
/** How much of the conversation fades out under the sheet's top edge while it is shorter than its content. */
const FADE_PX = 32;
/** The fastest a pull hands on to the spring, in pixels per millisecond; one jumpy sample can't fling the sheet. */
const MAX_PX_PER_MS = 3;
/** Critically damped: the sheet lands without wobbling or a long creep, and a grab mid-way keeps its speed. */
const SPRING = { stiffness: 700, damping: 53 };
/** The longest step the spring is worked out in, in seconds. */
const STEP_S = 1 / 240;
/** Over this much of its height the sheet's edge and fill come in, and over the same they leave. */
const EDGE_PX = 32;

export type PullHandleState = "rest" | "dragging";

/** The grab bar on the box's top edge. It widens and darkens under the pointer and while held. */
export function PullHandle({
  state = "rest",
  expanded,
  controls,
  onPress,
  onPointerDown,
  onKeyDown,
}: {
  state?: PullHandleState;
  expanded: boolean;
  controls?: string;
  onPress: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={styles.handle}
      data-slot="pull-handle"
      data-state={state}
      aria-label={expanded ? copy.chat.putBack : copy.handle.label}
      title={expanded ? undefined : copy.handle.hint}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onPress}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span className={styles.bar} />
    </button>
  );
}

export type ChatSheetState = "closed" | "open";

export type ChatSheetProps = {
  /** What is happening, in the pill above the box; null while nothing is. */
  status: StatusPillContent | null;
  /**
   * Whether the pill says what is running even with nothing to press: over the project, where the
   * conversation that says so is out of sight. Absent, the conversation is in sight.
   */
  saysWork?: boolean | undefined;
  /** The conversation, oldest first; the sheet scrolls to its end. Absent, there is nothing to pull up. */
  children?: ReactNode;
  /**
   * Takes the chat full screen: the room puts away what the sheet was pulled up over, and its own
   * conversation fills the page. Absent, the sheet offers no full screen.
   */
  onFullScreen?: (() => void) | undefined;
  /** Where the sheet starts. The sheet is its own after that. */
  defaultState?: ChatSheetState | undefined;
  /** A pull held this far up, in pixels, as if the pointer were still down; a story draws a pull with it. */
  defaultPull?: number | undefined;
  /**
   * Where the cursor goes once the chat is put back, such as the box's own field so the person
   * carries on typing; absent, it goes to the pill or handle that opens the chat again.
   */
  putBackTo?: RefObject<HTMLElement | null> | undefined;
};

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Grows up around the prompt box. `box` is the box itself, which never moves: the sheet reaches
 * past it by an even inset, so opening the chat changes nothing about where the person types.
 *
 * At rest the sheet is closed or open at the conversation's own height; full screen is the
 * room's own conversation, which `onFullScreen` goes back to. Between closed and open it is moving: a pull or a spring sets the history's height straight on the
 * element each frame, and the conversation is pinned to the box, so the newest line shows first
 * and anything taller fades out under the top edge rather than being cut.
 */
export function ChatSheet({
  status,
  saysWork = false,
  children,
  onFullScreen,
  defaultState = "closed",
  defaultPull,
  putBackTo,
  box,
}: ChatSheetProps & { box: ReactNode }) {
  const historyId = useId();
  const [state, setState] = useState<ChatSheetState>(defaultState);
  const [moving, setMoving] = useState(defaultPull !== undefined);
  const [held, setHeld] = useState(defaultPull !== undefined);
  const edgeRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  // The height the history has been given while moving, and the spring carrying it, if any.
  const height = useRef(defaultPull ?? 0);
  const spring = useRef<number | null>(null);
  // Where focus goes once the sheet has rendered its new state, when the control that had it went away.
  const refocus = useRef<"grip" | "handle" | null>(null);

  const shown = state !== "closed" || moving;
  const hasChat = children !== undefined && children !== null;

  // Pinned to the box, the history overflows upward, which scrollHeight does not count; how far
  // its header starts above or below its top edge says how tall it wants to be.
  const overflow = (history: HTMLElement) =>
    history.getBoundingClientRect().top -
    (history.firstElementChild?.getBoundingClientRect().top ?? 0);

  /** The height the conversation takes when open, capped as the stylesheet caps it. */
  const openHeight = () => {
    const history = historyRef.current;
    if (history === null || history.hidden) return 0;
    const cap = Number.parseFloat(getComputedStyle(history).maxHeight);
    const natural = history.getBoundingClientRect().height + overflow(history);
    return Math.min(natural, Number.isNaN(cap) ? Infinity : cap);
  };

  const paint = (next: number) => {
    height.current = next;
    const history = historyRef.current;
    if (history === null) return;
    history.style.height = `${String(next)}px`;
    // The fade stops short of the newest line, which is the one a short pull is for, unless that
    // line is itself only partly in: then it comes in faded rather than cut.
    const newestTop =
      messagesRef.current?.lastElementChild?.getBoundingClientRect().top ?? 0;
    const room = newestTop - history.getBoundingClientRect().top;
    const fade = Math.max(
      0,
      Math.min(FADE_PX, overflow(history), room > 0 ? room : FADE_PX),
    );
    history.style.setProperty("--fade", `${String(fade)}px`);
    // The edge comes in as the sheet leaves the box and goes as it comes back, so the sheet never
    // sits empty around the box, nor lingers faintly through the spring's last few pixels. A pill
    // above hands over to the handle the same way.
    const presence = Math.min(1, next / EDGE_PX) ** 2;
    edgeRef.current?.style.setProperty("opacity", String(presence));
    if (gripRef.current !== null) {
      gripRef.current.style.opacity = String(1 - presence);
      handleRef.current?.style.setProperty("opacity", String(presence));
    }
  };

  /** Past the conversation's height the sheet gives less and less, rather than stopping dead. */
  const resist = (next: number) => {
    const top = openHeight();
    return next > top ? top + Math.sqrt(next - top) * 4 : Math.max(0, next);
  };

  const stopSpring = () => {
    if (spring.current !== null) cancelAnimationFrame(spring.current);
    spring.current = null;
  };

  /** Comes to rest, either way, with nothing left of the motion on the element. */
  const settle = (next: "open" | "closed") => {
    stopSpring();
    setMoving(false);
    setState(next);
  };

  /** Springs from the current height to open or closed, keeping whatever speed a pull left it with. */
  const glide = (to: "open" | "closed", velocity = 0) => {
    stopSpring();
    if (reducedMotion()) return settle(to);
    setMoving(true);
    let v = velocity;
    let last = performance.now();
    const step = (now: number) => {
      const target = to === "open" ? openHeight() : 0;
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      // In small fixed steps: one long step after a slow frame would overshoot and ring.
      const steps = Math.ceil(dt / STEP_S);
      let next = height.current;
      for (let i = 0; i < steps; i += 1) {
        v +=
          (-SPRING.stiffness * (next - target) - SPRING.damping * v) *
          (dt / steps);
        next += v * (dt / steps);
      }
      if (Math.abs(next - target) < 0.5 && Math.abs(v) < 20) return settle(to);
      paint(resist(next));
      spring.current = requestAnimationFrame(step);
    };
    spring.current = requestAnimationFrame(step);
  };

  /** A press or a key: keys move it at once, as keyboard actions do; a pointer press springs. */
  const go = (to: "open" | "closed", animate: boolean) => {
    refocus.current = to === "open" ? "handle" : "grip";
    if (!animate) return settle(to);
    if (!moving) height.current = to === "open" ? 0 : openHeight();
    glide(to);
  };

  useEffect(() => stopSpring, []);

  // The first frame of a motion is painted before the history is shown and can be measured, so it
  // is painted again once it is. What a motion left on the elements is cleared in the same commit
  // as the state it lands in: any sooner, a frame would be painted between the two, the sheet
  // without its edge or the whole conversation back at full height before it is put away.
  useLayoutEffect(() => {
    if (moving) return paint(height.current);
    historyRef.current?.style.removeProperty("height");
    historyRef.current?.style.removeProperty("--fade");
    for (const ref of [edgeRef, gripRef, handleRef])
      ref.current?.style.removeProperty("opacity");
  }, [moving]);

  useLayoutEffect(() => {
    const target = refocus.current;
    if (target === null) return;
    const active = document.activeElement;
    // Only when the control that had focus is gone, so a person typing keeps their place. A press
    // springs the sheet first, its control still in place, so the way back waits for it to settle.
    if (active !== null && active !== document.body) {
      if (!moving) refocus.current = null;
      return;
    }
    refocus.current = null;
    const field = target === "grip" ? (putBackTo?.current ?? null) : null;
    if (field !== null) return field.focus();
    const ref = target === "grip" ? gripRef : handleRef;
    // Back to the chat's own control: the handle where one shows, else the pill standing in for it.
    const within = ref.current;
    (
      within?.querySelector<HTMLElement>('[data-slot="pull-handle"]') ??
      within?.querySelector<HTMLElement>("button")
    )?.focus();
  }, [state, moving]);

  // The newest line is the one to read, so the conversation opens at its end.
  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (shown && messages !== null) messages.scrollTop = messages.scrollHeight;
  }, [shown, state]);

  // Escape puts the chat back one step, wherever focus is, unless something inside used the key.
  useEffect(() => {
    if (state === "closed") return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      const active = document.activeElement;
      const inside = [historyRef, handleRef].some((ref) =>
        ref.current?.contains(active),
      );
      refocus.current = inside ? "grip" : null;
      settle("closed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state]);

  // A pull follows the pointer from wherever the sheet is, even mid-spring. Letting go settles it
  // the way a flick was going, or, slower, past the threshold open and short of it closed.
  const startPull = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const pointer = event.pointerId;
    const startY = event.clientY;
    const from = moving ? height.current : state === "open" ? openHeight() : 0;
    stopSpring();
    let moved = false;
    const recent = [{ y: startY, t: event.timeStamp }];
    let velocity = 0;
    setHeld(true);
    // On the window, not the button: the pill or handle that started the pull is swapped out as
    // the sheet appears, and the pull carries on.
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const travel = startY - next.clientY;
      if (!moved && Math.abs(travel) < PRESS_PX) return;
      if (!moved) {
        moved = true;
        height.current = from;
        // Now, not on React's next pass: the pull is painted below, onto a sheet already moving.
        flushSync(() => setMoving(true));
      }
      recent.push({ y: next.clientY, t: next.timeStamp });
      while (
        recent.length > 2 &&
        next.timeStamp - (recent[0]?.t ?? 0) > FLICK_WINDOW_MS
      )
        recent.shift();
      const first = recent[0] ?? { y: startY, t: event.timeStamp };
      const dt = next.timeStamp - first.t;
      if (dt > 0)
        velocity = Math.max(
          -MAX_PX_PER_MS,
          Math.min(MAX_PX_PER_MS, (first.y - next.clientY) / dt),
        );
      paint(resist(from + travel));
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointer) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setHeld(false);
      if (!moved) return;
      // Held still before letting go, the pull has no speed left to hand on.
      const lastMove = recent.at(-1)?.t ?? next.timeStamp;
      if (next.timeStamp - lastMove > FLICK_WINDOW_MS) velocity = 0;
      // The click that follows a pull is not a press; a pull that ends off the button has none.
      const swallow = (click: Event) => click.preventDefault();
      window.addEventListener("click", swallow, { once: true, capture: true });
      setTimeout(() => window.removeEventListener("click", swallow, true));
      const opens =
        Math.abs(velocity) > FLICK_PX_PER_MS
          ? velocity > 0
          : height.current >= OPENS_AT_PX;
      refocus.current = opens ? "handle" : "grip";
      glide(opens ? "open" : "closed", velocity * 1000);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const press = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.defaultPrevented) return;
    // A click from Enter or Space has no pointer position: detail is 0.
    go(shown ? "closed" : "open", event.detail !== 0);
  };

  // ArrowUp shows the chat and ArrowDown puts it back, as a pull would; Home and End go to the ends.
  const keyPull = (event: KeyboardEvent<HTMLButtonElement>) => {
    const to =
      event.key === "ArrowUp" || event.key === "End"
        ? "open"
        : event.key === "ArrowDown" || event.key === "Home"
          ? "closed"
          : null;
    if (to === null) return;
    event.preventDefault();
    if ((to === "open") !== shown) go(to, false);
  };

  const pullProps = {
    expanded: shown,
    controls: historyId,
    onPointerDown: startPull,
    onKeyDown: keyPull,
  };
  const handle = hasChat ? <PullHandle {...pullProps} onPress={press} /> : null;
  // A pill with an action of its own does that when pressed, and is not the chat's control, so
  // the handle stays beneath it: the chat never waits on the person pressing through actions.
  const pill =
    status === null || (status.onAction === undefined && !saysWork)
      ? null
      : status;
  const grip =
    pill === null ? (
      handle
    ) : pill.onAction !== undefined ? (
      <>
        <StatusPill {...pill} onPress={pill.onAction} />
        {handle}
      </>
    ) : (
      // With nothing of its own to do, the pill stands in for the handle and opens the chat.
      <StatusPill
        {...pill}
        {...(hasChat ? { ...pullProps, onPress: press } : {})}
      />
    );

  const sheetState = moving ? "moving" : state;
  return (
    <div
      className={styles.sheet}
      data-slot="chat-sheet"
      data-state={sheetState}
      data-held={held ? "" : undefined}
    >
      <div
        ref={edgeRef}
        className={styles.edge}
        data-slot="chat-sheet-edge"
        aria-hidden="true"
      />
      {grip === null || (shown && !(moving && pill !== null)) ? null : (
        <div ref={gripRef} className={styles.grip} data-slot="chat-grip">
          {grip}
        </div>
      )}
      {shown ? (
        <div ref={handleRef} className={styles.handleRow}>
          <PullHandle
            {...pullProps}
            state={held ? "dragging" : "rest"}
            onPress={press}
          />
        </div>
      ) : null}
      <div
        ref={historyRef}
        id={historyId}
        className={styles.history}
        data-slot="chat-history"
        hidden={!shown}
      >
        <header className={styles.header}>
          {onFullScreen === undefined ? null : (
            <button
              type="button"
              className={styles.icon}
              aria-label={copy.chat.fullScreen}
              title={copy.chat.fullScreen}
              onClick={onFullScreen}
            >
              <Maximize2 size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={styles.icon}
            aria-label={copy.chat.putBack}
            title={copy.chat.putBack}
            onClick={(event) => {
              refocus.current = "grip";
              go("closed", event.detail !== 0);
            }}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
        </header>
        <div
          ref={messagesRef}
          className={styles.messages}
          role="log"
          aria-label={copy.chat.title}
        >
          {children}
        </div>
      </div>
      <div className={styles.box} data-slot="chat-sheet-box">
        {box}
      </div>
    </div>
  );
}
