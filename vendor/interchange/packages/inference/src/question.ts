// The `question` pause: a `question` tool call is not run but parked on a
// question signal until a person answers, and their answer becomes the call's
// result. It waits as long as it takes; nothing about it times out.

import { type } from "arktype";
import {
  QUESTION_TOOL_NAME,
  QuestionArguments,
  QuestionToolInput,
  type AskedQuestion,
  type BeforeToolExtension,
  type ToolDefinition,
} from "@intx/types/runtime-core";

/** The `question` tool as the model sees it. An agent offers it by listing it. */
export const questionTool: ToolDefinition = {
  name: QUESTION_TOOL_NAME,
  description:
    "Ask the person one or more questions and wait for their answers. Each question has the full question, a short header, and options with a label and a description. Put the option you recommend first and end its label with (Recommended). Leave options empty for a free-text answer. multiple lets the person pick several. custom, on by default, lets them type their own answer, so do not add an Other option. The result is { answers: [{ question, answer: [chosen labels or typed text] }] } in the order asked, or { reply } when the person wrote back instead of answering. To show the person a screen instead, pass plugin with the screen's name, action when the plugin names its screens by action, and input with what it needs, and no questions; the result is { output } from the screen, or { reply }.",
  inputSchema: { ...QuestionToolInput.toJsonSchema() },
};

/** The arguments of a `question` call that shows a screen. */
export type PluginQuestion = Extract<QuestionArguments, { plugin: string }>;

/**
 * Checks a plugin question's input before it is parked: refusal text blocks
 * the call with that text as its result, undefined lets it park. The runtime
 * carries the input without reading it, so only the host offering the
 * screen can say whether the input is one it can draw.
 */
export type QuestionCheck = (
  question: PluginQuestion,
) => string | undefined | Promise<string | undefined>;

export function createQuestionExtension(
  checkQuestion?: QuestionCheck,
): BeforeToolExtension {
  return {
    async beforeTool(call) {
      if (call.name !== QUESTION_TOOL_NAME) return { type: "allow" };
      if ("questions" in call.arguments && "plugin" in call.arguments) {
        return {
          type: "block",
          reason: "Invalid question: pass questions or a plugin, not both",
        };
      }
      const question = QuestionArguments(call.arguments);
      if (question instanceof type.errors) {
        return {
          type: "block",
          reason: `Invalid question: ${question.summary}`,
        };
      }
      if (checkQuestion !== undefined && "plugin" in question) {
        const refusal = await checkQuestion(question);
        if (refusal !== undefined) return { type: "block", reason: refusal };
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
          question: asked(question),
        },
      };
    },
  };
}

function asked(question: QuestionArguments): AskedQuestion {
  if ("plugin" in question) {
    const { plugin, action, input } = question;
    return action === undefined ? { plugin, input } : { plugin, action, input };
  }
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
