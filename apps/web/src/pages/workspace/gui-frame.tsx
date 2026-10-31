/**
 * The design owner's HTML, shown as a page. The sandbox never grants same-origin access; scripts
 * run only for a designer's mockup. A running generated app is AppFrame.
 */
import { useEffect, useRef, type Ref } from "react";

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
}: {
  html: string;
  frameRef?: Ref<HTMLIFrameElement> | undefined;
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
      className="gui-frame"
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
}: {
  html: string | null;
  scripts?: boolean;
  frameRef?: Ref<HTMLIFrameElement> | undefined;
}) {
  if (html === null || html.trim().length === 0) {
    return <p className="inline-note">No design to show.</p>;
  }
  // The host takes one page, so a changed page is a fresh frame.
  if (scripts)
    return <ScriptedFrame key={html} html={html} frameRef={frameRef} />;
  return (
    <iframe
      ref={frameRef}
      className="gui-frame"
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
export function AppFrame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      className="gui-frame"
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      // An iframe gets no powerful features unless its permissions policy lists them, so the app
      // can ask for location, camera or the clipboard exactly as it would in its own tab.
      allow="geolocation; camera; microphone; clipboard-read; clipboard-write; fullscreen"
      src={src}
    />
  );
}
