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
    "Ask the person one or more questions and wait for their answers. Each question has the full question, a short header, and options with a label and a description. Put the option you recommend first and end its label with (Recommended). Leave options empty for a free-text answer. multiple lets the person pick several. custom, on by default, lets them type their own answer, so do not add an Other option. The result is { answers: [{ question, answer: [chosen labels or typed text] }] } in the order asked, or { reply } when the person wrote back instead of answering.",
  inputSchema: { ...QuestionArguments.toJsonSchema() },
};

export function createQuestionExtension(): BeforeToolExtension {
  return {
    async beforeTool(call) {
      if (call.name !== QUESTION_TOOL_NAME) return { type: "allow" };
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
