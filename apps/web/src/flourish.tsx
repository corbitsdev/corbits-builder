import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { wording } from "./config.ts";
import { Mark } from "./components.jsx";
import "./flourish.css";

const FINE_MS = 3000;
const CARD_MS = 6000;
const SWARM_FLY_MS = 3200;
const SWARM_MAX_DELAY_MS = 1800;
const SWARM_FLYERS = 32;
const LOGO_CLICKS = 7;
const LOGO_WINDOW_MS = 2500;
const SHELL_MS = 4500;

type FlyerProps = { className: string; style: CSSProperties };

function Drawing({
  className,
  style,
  children,
}: FlyerProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function HockeyStick(props: FlyerProps) {
  return (
    <Drawing {...props}>
      <path
        className="flourish-flyer-fill"
        d="M4.2 2.4L6 1.6l8.6 15.4q.4.8 1.4.8h5q1 0 1 1v.8q0 1-1 1h-6.5q-1.9 0-2.7-1.7z"
      />
      <path d="M5 4.4l1.9-.9M5.7 5.9l1.9-.9M6.4 7.4l1.9-.9M17 17.8v2.8M18.2 17.8v2.8M19.4 17.8v2.8" />
    </Drawing>
  );
}

function PalmTree(props: FlyerProps) {
  return (
    <Drawing {...props}>
      <path d="M10 22c.4-4.5 1.4-9 3-13M10.6 18.5l1.6.3M11.1 15.4l1.6.4M11.9 12.4l1.5.4" />
      <path
        className="flourish-flyer-fill"
        d="M13 9C10 9 6 11 5 15c2-3 5-4.5 8-6zM13 9c3 0 7 2 8 6-2-3-5-4.5-8-6zM13 9c-1-3 0-5.5 2-6.5-1 2.5-1 4.5-2 6.5z"
      />
      <path
        className="flourish-flyer-fill-strong"
        d="M13 9C10 6 6 6 3 9c3-1 7-1 10 0zM13 9c3-3 7-3 9 0-3-1-6-1-9 0z"
      />
      <circle
        className="flourish-flyer-fill-strong"
        cx="12.2"
        cy="10.4"
        r=".9"
      />
      <circle className="flourish-flyer-fill-strong" cx="14" cy="10.6" r=".9" />
    </Drawing>
  );
}

const FLYER_KINDS = [HockeyStick, PalmTree];

function typingInto(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable]") !== null)
  );
}

/** Typing "fine" outside any field makes the interface deliberately bad for a moment. */
export function FineMode() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let typed = "";
    const onKey = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typingInto(event.target)
      )
        return;
      typed = (typed + event.key.toLowerCase()).slice(-4);
      if (typed === "fine") setOn(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!on) return;
    document.documentElement.dataset.ux = "fine";
    const timer = setTimeout(() => setOn(false), FINE_MS);
    return () => {
      clearTimeout(timer);
      delete document.documentElement.dataset.ux;
    };
  }, [on]);
  return on ? (
    <div className="flourish-fine-banner" role="status">
      {wording.flourish.fine}
    </div>
  ) : null;
}

/** The sidebar mark; seven quick clicks show who made it. Clicks are counted by position because
 * the open workspace menu takes pointer events from the page; earlier ones still reach the menu. */
export function LogoMark({ size }: { size: number }) {
  const mark = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let clicks: number[] = [];
    const onPointer = (event: globalThis.PointerEvent) => {
      const box = mark.current?.getBoundingClientRect();
      if (!box) return;
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) return;
      clicks = [
        ...clicks.filter((at) => event.timeStamp - at < LOGO_WINDOW_MS),
        event.timeStamp,
      ];
      if (clicks.length < LOGO_CLICKS) return;
      clicks = [];
      event.preventDefault();
      setShown(true);
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, []);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(false), CARD_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return (
    <>
      <span className="flourish-logo" ref={mark}>
        <Mark size={size} />
      </span>
      {shown ? (
        <div className="flourish-card" role="status">
          <span className="flourish-card-mark">
            <Mark size={28} />
          </span>
          <a href="https://corbits.dev" target="_blank" rel="noreferrer">
            {wording.flourish.madeWithCare}
          </a>
        </div>
      ) : null}
    </>
  );
}

/** The owner's credit, a quiet footer line; clicking it throws a swarm of flyers across the page. */
export function Credit() {
  const [swarm, setSwarm] = useState(0);
  useEffect(() => {
    if (!swarm) return;
    const timer = setTimeout(
      () => setSwarm(0),
      SWARM_FLY_MS + SWARM_MAX_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [swarm]);
  return (
    <>
      <button
        type="button"
        className="flourish-credit"
        onClick={() => setSwarm(Date.now())}
      >
        {wording.flourish.forgedBy}
      </button>
      {swarm ? <FlyerSwarm key={swarm} /> : null}
    </>
  );
}

function FlyerSwarm() {
  const flyers = useMemo(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    return Array.from({ length: reduced ? 1 : SWARM_FLYERS }, () => {
      const edge = Math.floor(Math.random() * 4);
      const along = Math.random() * 100;
      const [fromX, fromY] = [
        [along, -10],
        [110, along],
        [along, 110],
        [-10, along],
      ][edge]!;
      const [toX, toY] = [
        [Math.random() * 100, 110],
        [-10, Math.random() * 100],
        [Math.random() * 100, -10],
        [110, Math.random() * 100],
      ][edge]!;
      return {
        Kind: FLYER_KINDS[Math.floor(Math.random() * FLYER_KINDS.length)]!,
        style: {
          "--from-x": `${fromX}vw`,
          "--from-y": `${fromY}vh`,
          "--to-x": `${toX}vw`,
          "--to-y": `${toY}vh`,
          "--spin": `${(Math.random() < 0.5 ? -1 : 1) * (540 + Math.random() * 720)}deg`,
          "--size": `${24 + Math.random() * 28}px`,
          animationDuration: reduced ? undefined : `${SWARM_FLY_MS}ms`,
          animationDelay: `${reduced ? 0 : Math.random() * SWARM_MAX_DELAY_MS}ms`,
        } as CSSProperties,
      };
    });
  }, []);
  return (
    <div className="flourish-swarm" aria-hidden="true">
      {flyers.map(({ Kind, style }, index) => (
        <Kind key={index} className="flourish-swarm-flyer" style={style} />
      ))}
    </div>
  );
}

const SANDWICH = String.raw`
   _______________
  /               \
 (~~~~~~~~~~~~~~~~~)
  |%%%%%%%%%%%%%%%|
  (@@@@@@@@@@@@@@@)
  \_______________/`;

/** Answers one shell request typed into the composer with a terminal over `area`. Returns
 * `answers`, true when it took the message, and the `reply` to render. */
export function useShellReply(area: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<{ at: number; style: CSSProperties } | null>(
    null,
  );
  useEffect(() => {
    if (!box) return;
    const timer = setTimeout(() => setBox(null), SHELL_MS);
    return () => clearTimeout(timer);
  }, [box]);
  const answers = (message: string) => {
    if (message.trim() !== wording.flourish.shellRequest) return false;
    const rect = area.current?.getBoundingClientRect();
    setBox({
      at: Date.now(),
      style: rect
        ? {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }
        : { inset: 0 },
    });
    return true;
  };
  const reply = box ? (
    <div
      key={box.at}
      className="flourish-shell"
      style={box.style}
      role="status"
    >
      <pre className="flourish-shell-screen">
        {`$ ${wording.flourish.shellRequest}`}
        <span className="flourish-shell-answer">{`\n${wording.flourish.shellAnswer}${SANDWICH}`}</span>
      </pre>
    </div>
  ) : null;
  return { answers, reply };
}
