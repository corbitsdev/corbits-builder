/**
 * The design owner's HTML, shown as a page. The sandbox never grants same-origin access; scripts
 * run only for a designer's mockup. A running generated app is AppFrame.
 */
import { useEffect, useRef, type Ref } from "react";
import { InlineNote } from "../../components.tsx";
import styles from "./gui-frame.module.css";

/** How the frame is sized: a page-high frame, the whole of a flex container, or a scaled-down still. */
type FrameSize = {
  /** Grows to fill a flex container instead of taking a page's height. */
  fill?: boolean | undefined;
  /** Lays the page out at desktop width and scales it to a quarter, over a positioned container. */
  thumbnail?: boolean | undefined;
};

const sizeAttributes = ({ fill = false, thumbnail = false }: FrameSize) => ({
  "data-fill": fill ? "" : undefined,
  "data-thumbnail": thumbnail ? "" : undefined,
});

const MOCKUP_HOST = "/mockup-frame.html";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

// Scripted pages cannot be srcdoc: that inherits the workspace's script-src 'self' and every
// inline mockup script is blocked. The host page has its own offline policy and asks for the page.
function ScriptedFrame({
  html,
  frameRef,
  size,
}: {
  html: string;
  frameRef?: Ref<HTMLIFrameElement> | undefined;
  size: FrameSize;
}) {
  const own = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const send = (event: MessageEvent) => {
      const target = own.current?.contentWindow;
      if (!target || event.source !== target) return;
      if (
        (event.data as { mockupReady?: unknown } | null)?.mockupReady !== true
      )
        return;
      target.postMessage({ mockupHtml: html }, "*");
    };
    window.addEventListener("message", send);
    return () => window.removeEventListener("message", send);
  }, [html]);
  return (
    <iframe
      ref={(node) => {
        own.current = node;
        assignRef(frameRef, node);
      }}
      className={styles.frame}
      data-slot="gui-frame"
      {...sizeAttributes(size)}
      title="Design"
      sandbox="allow-scripts"
      src={MOCKUP_HOST}
    />
  );
}

export function GuiFrame({
  html,
  scripts = false,
  frameRef,
  fill,
  thumbnail,
}: {
  html: string | null;
  scripts?: boolean;
  frameRef?: Ref<HTMLIFrameElement> | undefined;
} & FrameSize) {
  const size = { fill, thumbnail };
  if (html === null || html.trim().length === 0) {
    return <InlineNote>No design to show.</InlineNote>;
  }
  // The host takes one page, so a changed page is a fresh frame.
  if (scripts)
    return (
      <ScriptedFrame key={html} html={html} frameRef={frameRef} size={size} />
    );
  return (
    <iframe
      ref={frameRef}
      className={styles.frame}
      data-slot="gui-frame"
      {...sizeAttributes(size)}
      title="Design"
      sandbox=""
      srcDoc={html}
    />
  );
}

/**
 * The running app at the origin the hub serves it on, which is never the workspace's own, so the
 * app keeps its own storage and requests while it cannot reach the workspace or its session.
 */
export function AppFrame({
  src,
  title,
  fill,
}: {
  src: string;
  title: string;
  fill?: boolean | undefined;
}) {
  return (
    <iframe
      className={styles.frame}
      data-slot="gui-frame"
      {...sizeAttributes({ fill })}
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      // An iframe gets no powerful features unless its permissions policy lists them, so the app
      // can ask for location, camera or the clipboard exactly as it would in its own tab.
      allow="geolocation; camera; microphone; clipboard-read; clipboard-write; fullscreen"
      src={src}
    />
  );
}
