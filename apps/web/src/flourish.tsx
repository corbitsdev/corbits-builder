import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { wording } from "./config.ts";
import { Mark } from "./components.jsx";
import styles from "./flourish.module.css";

const FINE_MS = 3000;
const CARD_MS = 6000;
const LOGO_CLICKS = 7;
const LOGO_WINDOW_MS = 2500;
const SHELL_MS = 4500;

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
    <div className={styles.fineBanner} role="status">
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
      <span className={styles.logo} ref={mark}>
        <Mark size={size} />
      </span>
      {shown ? (
        <div className={styles.card} role="status">
          <span className={styles.cardMark}>
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
    <div key={box.at} className={styles.shell} style={box.style} role="status">
      <pre className={styles.shellScreen}>
        {`$ ${wording.flourish.shellRequest}`}
        <span
          className={styles.shellAnswer}
        >{`\n${wording.flourish.shellAnswer}${SANDWICH}`}</span>
      </pre>
    </div>
  ) : null;
  return { answers, reply };
}
