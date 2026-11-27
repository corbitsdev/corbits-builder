/**
 * The room's questions: the coordinator run's questions as the hub read them, the open one, and
 * sending the person's answer to it. The hub decides each question's status; this only marks an
 * answer it has accepted as answered while the hub's reads still say open.
 */
import { useRef, useState } from "react";
import {
  answeredWith,
  type ConversationQuestion,
  type GivenQuestionAnswer,
  deliveredAnswer,
} from "@corbits-builder/schemas/conversation";
import { ProductApiError } from "@corbits-builder/client";
import { wording } from "../../config.ts";
import type { AnswerOutcome } from "./question-outcome.tsx";
import { answerQuestion } from "../../api/conversation.ts";

export function useQuestions({
  projectId,
  runId,
  loaded,
  archived,
  reload,
  onChanged,
  setSending,
}: {
  projectId: string;
  runId: string | null;
  /** The questions in the room's latest read. */
  loaded: readonly ConversationQuestion[];
  archived: boolean;
  reload: () => void;
  onChanged: () => void;
  setSending: (sending: boolean) => void;
}): {
  outcomes: ReadonlyMap<string, AnswerOutcome>;
  questions: ConversationQuestion[];
  openQuestion: ConversationQuestion | undefined;
  answer: (signalName: string, answer: GivenQuestionAnswer) => Promise<boolean>;
} {
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, AnswerOutcome>>(
    () => new Map(),
  );
  const inFlight = useRef(new Set<string>());
  const record = (signal: string, outcome: AnswerOutcome) =>
    setOutcomes((current) => {
      const next = new Map(current);
      next.delete(signal);
      next.set(signal, outcome);
      return next;
    });
  // An answer the hub accepted shows as answered while the hub's reads still say open, so its card
  // settles at once and later typing goes to the conversation rather than to an answered question.
  const questions = (archived ? [] : loaded).map(
    (question): ConversationQuestion => {
      const outcome = outcomes.get(question.signalName);
      if (question.status !== "open" || outcome?.kind !== "accepted")
        return question;
      return answeredWith(question, outcome.answer);
    },
  );
  // Every entry point shares this outcome; no view infers delivery from its own callback.
  const deliverAnswer = async (
    signalName: string,
    answer: GivenQuestionAnswer,
  ): Promise<boolean> => {
    if (inFlight.current.has(signalName)) return false;
    inFlight.current.add(signalName);
    record(signalName, { kind: "sending" });
    setSending(true);
    let accepted = false;
    try {
      await answerQuestion(projectId, signalName, answer);
      accepted = true;
      // The card settles on what the run received, as the hub's next read will show it.
      record(signalName, {
        kind: "accepted",
        answer: deliveredAnswer(answer),
      });
      reload();
      onChanged();
      return true;
    } catch (cause) {
      const status =
        cause instanceof ProductApiError ? cause.response.status : undefined;
      let code: string | undefined;
      let decoding: unknown;
      if (cause instanceof ProductApiError) {
        try {
          const body: unknown = await cause.response.clone().json();
          if (
            body !== null &&
            typeof body === "object" &&
            "code" in body &&
            typeof body.code === "string"
          )
            code = body.code;
        } catch (error) {
          decoding = error;
        }
      }
      const kind = answerFailure(status, code, accepted);
      const fault = wording.questions.answerFault[kind];
      if (kind === "accepted")
        record(signalName, { kind, answer: deliveredAnswer(answer), fault });
      else record(signalName, { kind, fault });
      const question = loaded.find(
        (question) => question.signalName === signalName,
      );
      console.warn("Question answer failed", {
        signal: signalName,
        plugin:
          question !== undefined && "plugin" in question.asked
            ? question.asked.plugin
            : undefined,
        action:
          question !== undefined && "action" in question.asked
            ? question.asked.action
            : undefined,
        project: projectId,
        run: runId,
        status,
        code,
        outcome: kind,
        responseUnreadable: decoding !== undefined,
      });
      return accepted;
    } finally {
      inFlight.current.delete(signalName);
      setSending(inFlight.current.size > 0);
    }
  };
  return {
    outcomes,
    questions,
    openQuestion: questions.find(({ status }) => status === "open"),
    answer: deliverAnswer,
  };
}

/** Only an explicit refusal or unavailable signal route proves that delivery did not happen. */
export function answerFailure(
  status: number | undefined,
  code: string | undefined,
  accepted: boolean,
): "refused" | "unsent" | "unknown" | "accepted" {
  if (accepted) return "accepted";
  if (
    status === 503 &&
    (code === "question_answer_unavailable" ||
      code === "conversation_unreadable")
  )
    return "unsent";
  if (status !== undefined && status >= 400 && status < 500 && status !== 408)
    return "refused";
  return "unknown";
}
