import type { QuestionAnswer } from "@corbits-builder/schemas/conversation";
import { Fault } from "../../../components.jsx";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

export type AnswerOutcome =
  | { kind: "sending" }
  | { kind: "accepted"; answer: QuestionAnswer; fault?: string }
  | { kind: "refused" | "unsent" | "unknown"; fault: string };

export const QuestionOutcomes = createContext<
  ReadonlyMap<string, AnswerOutcome>
>(new Map());

export function useQuestionOutcome(signalName: string) {
  return useContext(QuestionOutcomes).get(signalName);
}

/** Lives in the conversation, above hosts that disappear after Cancel or a page submission. */
export function QuestionEntry({
  signalName,
  children,
}: {
  signalName: string;
  children: ReactNode;
}) {
  const outcome = useQuestionOutcome(signalName);
  const entry = useRef<HTMLDivElement>(null);
  const previous = useRef(outcome);
  useEffect(() => {
    if (outcome?.kind === "accepted" && previous.current?.kind !== "accepted") {
      const active = document.activeElement;
      if (
        active === document.body ||
        active === null ||
        entry.current?.contains(active)
      ) {
        const settled = entry.current?.querySelector<HTMLElement>(
          '[data-slot="question-settled"]',
        );
        if (settled !== undefined && settled !== null) settled.focus();
        else entry.current?.focus();
      }
    }
    previous.current = outcome;
  }, [outcome]);
  return (
    <div ref={entry} tabIndex={-1} data-slot="question-entry">
      {children}
      {outcome?.kind === "accepted" && outcome.fault !== undefined ? (
        <Fault>{outcome.fault}</Fault>
      ) : null}
    </div>
  );
}
