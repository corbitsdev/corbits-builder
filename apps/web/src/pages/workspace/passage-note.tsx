/**
 * A passage the person points at goes into their own message box as a quote, beside whatever
 * they write; it is a conversation message, not an artifact comment.
 */
import { Button, useDismissablePopover } from "@corbits/react-ui";
import { MessageSquareQuote } from "lucide-react";
import { createContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { wording } from "../../config.ts";

export type PassageQuote = {
  quote: string;
  version: number;
  title: string;
};

const QUOTE_LIMIT = 600;

export function formatPassageQuote(passage: PassageQuote): string {
  const quote = passage.quote.replace(/\s+/g, " ").trim().slice(0, QUOTE_LIMIT);
  return `On "${passage.title}" v${String(passage.version)}:\n\n> ${quote}\n\n`;
}

/** Offers a passage read from a sandboxed preview, which the page itself cannot select into. */
export const QuoteOffer = createContext<
  ((quote: string, rect: DOMRect) => void) | null
>(null);

function passageQuote(
  target: EventTarget | null,
  root: HTMLElement,
): string | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("button, a, input, textarea, select, label, iframe"))
    return null;
  const block = target.closest(
    "p, li, h1, h2, h3, h4, blockquote, pre, td, th",
  );
  if (!block || !root.contains(block)) return null;
  const text = block.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.length > 0 ? text : null;
}

export function PassageQuotes({
  title,
  version,
  onAdd,
  children,
}: {
  title: string;
  version: number;
  onAdd?: (passage: PassageQuote) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const skipClick = useRef(false);
  const [offer, setOffer] = useState<{
    quote: string;
    top: number;
    left: number;
  } | null>(null);
  const { rootRef: offerRef } = useDismissablePopover<HTMLDivElement>({
    open: offer !== null,
    onOpenChange: (open) => {
      if (!open) setOffer(null);
    },
  });

  if (onAdd === undefined) return children;

  const open = (quote: string, rect: DOMRect) => {
    const clean = quote.replace(/\s+/g, " ").trim().slice(0, QUOTE_LIMIT);
    if (clean.length === 0) return;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - 160),
    );
    const top = Math.min(rect.bottom + 6, window.innerHeight - 48);
    setOffer({ quote: clean, top, left });
  };

  const add = () => {
    if (offer === null) return;
    onAdd({ quote: offer.quote, version, title });
    setOffer(null);
    window.getSelection()?.removeAllRanges();
  };

  const pill =
    offer === null ? null : (
      <div
        ref={offerRef}
        className="passage-offer"
        style={{ top: offer.top, left: offer.left }}
      >
        <Button size="sm" onClick={add}>
          <MessageSquareQuote size={14} aria-hidden="true" />
          {wording.passage.addToPrompt}
        </Button>
      </div>
    );

  return (
    <QuoteOffer.Provider value={open}>
      <div
        ref={rootRef}
        className="passage-notes"
        onMouseUp={() => {
          if (rootRef.current === null) return;
          const selection = window.getSelection();
          const text = selection?.toString() ?? "";
          if (
            text.trim().length === 0 ||
            selection === null ||
            selection.rangeCount === 0
          )
            return;
          const range = selection.getRangeAt(0);
          if (!rootRef.current.contains(range.commonAncestorContainer)) return;
          skipClick.current = true;
          open(text, range.getBoundingClientRect());
        }}
        onClick={(event) => {
          if (rootRef.current === null) return;
          if (skipClick.current) {
            skipClick.current = false;
            return;
          }
          const quote = passageQuote(event.target, rootRef.current);
          if (quote === null || !(event.target instanceof Element)) return;
          open(quote, event.target.getBoundingClientRect());
        }}
      >
        {children}
        {pill && typeof document !== "undefined"
          ? createPortal(pill, document.body)
          : pill}
      </div>
    </QuoteOffer.Provider>
  );
}
