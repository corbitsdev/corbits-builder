// The `question` pause: a `question` tool call is not run but parked on a
// question signal until a person answers, and their answer becomes the call's
// result. It waits as long as it takes; nothing about it times out.

import { type } from "arktype";
import {
  QUESTION_TOOL_NAME,
  QuestionArguments,
  type BeforeToolExtension,
  type ToolDefinition,
} from "@intx/types/runtime-core";

/** The `question` tool as the model sees it. An agent offers it by listing it. */
export const questionTool: ToolDefinition = {
  name: QUESTION_TOOL_NAME,
  description:
    "Ask the person one or more questions and wait for their answers. Call it on its own, with no other tool call in the same reply. Each question has the full question, a short header, and options with a label and a description. Put the option you recommend first and end its label with (Recommended). Leave options empty for a free-text answer. multiple lets the person pick several. custom, on by default, lets them type their own answer, so do not add an Other option. The result is { answers: [{ question, answer: [chosen labels or typed text] }] } in the order asked, or { reply } when the person wrote back instead of answering.",
  inputSchema: {
    ...QuestionArguments.toJsonSchema({
      // The defaults and the option rules have no JSON Schema form; the call
      // is checked against the full type when it arrives.
      fallback: {
        morph: (ctx) => ctx.base,
        predicate: (ctx) => ctx.base,
      },
    }),
  },
};

export function createQuestionExtension(): BeforeToolExtension {
  return {
    async beforeTool(call, state) {
      if (call.name !== QUESTION_TOOL_NAME) return { type: "allow" };
      // A run waits on only the first pause in a reply, so a question that
      // shares its reply with another pausing call leaves one of them paused
      // with nothing waiting on it.
      const turn = state.turns.findLast((t) =>
        t.content.some((b) => b.type === "tool_call" && b.id === call.id),
      );
      const calls = turn?.content.filter((b) => b.type === "tool_call") ?? [];
      if (calls.length > 1) {
        return {
          type: "block",
          reason:
            "A question must be the only tool call in its reply. Ask it on its own in your next reply.",
        };
      }
      const question = QuestionArguments(call.arguments);
      if (question instanceof type.errors) {
        return {
          type: "block",
          reason: `Invalid question: ${question.summary}`,
        };
      }
      const correlationId = crypto.randomUUID();
      const gateId = `pending-${correlationId}`;
      return {
        type: "suspend",
        gate: { type: "question", gateId, correlationId },
        pendingOp: {
          correlationId,
          kind: "question",
          registeredAt: Date.now(),
          gateId,
          suspendedCall: call,
          question: {
            questions: question.questions.map((prompt) => ({
              id: crypto.randomUUID(),
              question: prompt.question,
              header: prompt.header,
              options: prompt.options,
              multiple: prompt.multiple,
              custom: prompt.custom,
            })),
          },
        },
      };
    },
  };
}
