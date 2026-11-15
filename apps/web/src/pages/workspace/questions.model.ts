/**
 * The room's questions: the coordinator run's questions as the hub read them, the open one, and
 * sending the person's answer to it. The hub decides each question's status; this only marks an
 * answer it has accepted as answered while the hub's reads still say open.
 */
import { useState } from "react";
import { toast } from "sonner";
import type {
  ConversationQuestion,
  QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { answerQuestion } from "../../api/conversation.ts";
import { humanFaultWithCode } from "./human-fault.ts";

export function useQuestions({
  projectId,
  loaded,
  archived,
  notSent,
  reload,
  onChanged,
  setSending,
  setSendFailed,
  setSendFault,
}: {
  projectId: string;
  /** The questions in the room's latest read. */
  loaded: readonly ConversationQuestion[];
  archived: boolean;
  /** The fault shown when the hub gives no reason of its own. */
  notSent: string;
  reload: () => void;
  onChanged: () => void;
  setSending: (sending: boolean) => void;
  setSendFailed: (failed: boolean) => void;
  setSendFault: (fault: string | null) => void;
}): {
  questions: ConversationQuestion[];
  openQuestion: ConversationQuestion | undefined;
  answer: (signalName: string, answer: QuestionAnswer) => Promise<boolean>;
} {
  // An answer the hub accepted shows as answered while the hub's reads still say open, so its card
  // settles at once and later typing goes to the conversation rather than to an answered question.
  const [sentAnswers, setSentAnswers] = useState<
    ReadonlyMap<string, QuestionAnswer>
  >(() => new Map());
  const questions = (archived ? [] : loaded).map(
    (question): ConversationQuestion => {
      const sent = sentAnswers.get(question.signalName);
      if (question.status !== "open" || sent === undefined) return question;
      // Required makes a field the entries gain later fail to compile here rather than vanish.
      return {
        at: question.at,
        signalName: question.signalName,
        asked: question.asked,
        status: "answered",
        answer: sent,
      } satisfies Required<
        Extract<ConversationQuestion, { status: "answered" }>
      >;
    },
  );
  // An answer lands in the run log, not the conversation, so it never shows as a sent message.
  const deliverAnswer = async (
    signalName: string,
    answer: QuestionAnswer,
  ): Promise<boolean> => {
    setSending(true);
    setSendFailed(false);
    setSendFault(null);
    try {
      await answerQuestion(projectId, signalName, answer);
      setSentAnswers((sent) => new Map(sent).set(signalName, answer));
      reload();
      onChanged();
      return true;
    } catch (cause) {
      const message = await humanFaultWithCode(cause, notSent);
      setSendFailed(true);
      setSendFault(message);
      toast.error(message);
      // A refusal can mean the question closed meanwhile, so the room reads it again.
      reload();
      return false;
    } finally {
      setSending(false);
    }
  };
  return {
    questions,
    openQuestion: questions.find(({ status }) => status === "open"),
    answer: deliverAnswer,
  };
}
