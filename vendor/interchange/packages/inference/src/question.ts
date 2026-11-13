// The `question` pause: a `question` tool call is not run but parked on a
// question signal until a person answers, and their answer becomes the call's
// result. It waits as long as it takes; nothing about it times out. The host
// may park any other call the same way, on a screen the person answers.

import { type } from "arktype";
import {
  QUESTION_TOOL_NAME,
  QuestionArguments,
  type AskedQuestion,
  type BeforeToolDecision,
  type BeforeToolExtension,
  type PendingOperation,
  type ToolCall,
  type ToolDefinition,
} from "@intx/types/runtime-core";

/** The `question` tool as the model sees it. An agent offers it by listing it. */
export const questionTool: ToolDefinition = {
  name: QUESTION_TOOL_NAME,
  description:
    "Ask the person one or more questions and wait for their answers. Each question has the full question, a short header, and options with a label and a description. Put the option you recommend first and end its label with (Recommended). Leave options empty for a free-text answer. multiple lets the person pick several. custom, on by default, lets them type their own answer, so do not add an Other option. The result is { answers: [{ question, answer: [chosen labels or typed text] }] } in the order asked, or { reply } when the person wrote back instead of answering.",
  inputSchema: { ...QuestionArguments.toJsonSchema() },
};

/**
 * A screen the host parks a call on, and what the person's answer does:
 * "result" makes it the call's result, "rerun" runs the parked call once.
 */
export type CallPause = {
  plugin: string;
  action?: string;
  input: Record<string, unknown>;
  resume: "result" | "rerun";
};

/**
 * Asks the host about a call that is not a question before it runs: undefined
 * runs it, refusal text blocks it with that text as its result, and a pause
 * parks it on a screen. The runtime carries the screen's input without reading
 * it, so only the host offering the screen can say what it draws.
 */
export type CallCheck = (
  call: ToolCall,
) => CallPause | string | undefined | Promise<CallPause | string | undefined>;

export function createQuestionExtension(
  checkCall?: CallCheck,
): BeforeToolExtension {
  // A call re-run after the person answered its screen runs without asking
  // the host again; see `grantOneShot`.
  const answered = new Set<string>();
  return {
    grantOneShot(id) {
      answered.add(id);
    },
    async beforeTool(call) {
      if (call.name === QUESTION_TOOL_NAME) {
        const question = QuestionArguments(call.arguments);
        if (question instanceof type.errors) {
          return {
            type: "block",
            reason: `Invalid question: ${question.summary}`,
          };
        }
        return suspend(call, asked(question));
      }
      if (answered.delete(call.id) || checkCall === undefined) {
        return { type: "allow" };
      }
      const decision = await checkCall(call);
      if (decision === undefined) return { type: "allow" };
      if (typeof decision === "string") {
        return { type: "block", reason: decision };
      }
      const { plugin, action, input, resume } = decision;
      return suspend(
        call,
        action === undefined ? { plugin, input } : { plugin, action, input },
        resume === "rerun",
      );
    },
  };
}

function suspend(
  call: ToolCall,
  question: AskedQuestion,
  rerun = false,
): BeforeToolDecision {
  const correlationId = crypto.randomUUID();
  const gateId = `pending-${correlationId}`;
  const pendingOp: PendingOperation = {
    correlationId,
    kind: "question",
    registeredAt: Date.now(),
    gateId,
    suspendedCall: call,
    question,
  };
  if (rerun) pendingOp.rerun = true;
  return {
    type: "suspend",
    gate: { type: "question", gateId, correlationId },
    pendingOp,
  };
}

function asked(question: QuestionArguments): AskedQuestion {
  return {
    questions: question.questions.map((prompt) => ({
      id: crypto.randomUUID(),
      question: prompt.question,
      header: prompt.header,
      options: prompt.options,
      multiple: prompt.multiple,
      custom: prompt.custom,
    })),
  };
}
