// The `question` pause: a `question` tool call is not run but parked on a
// question signal until a person answers, and their answer becomes the call's
// result. The reactor sets no timer on it; a workflow step's own timeout still
// ends the wait, as it does an approval's. Only a top-level agent step can ask:
// a parent run cannot relay a question from a loop or onTrigger body.
// The host may park any other call the same way, on a screen.

import { type } from "arktype";
import {
  QUESTION_TOOL_NAME,
  QuestionArguments,
  type BeforeToolExtension,
  type PendingOperation,
  QuestionScreen,
  type ToolCall,
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
      // with nothing waiting on it. Whether another call would pause for an
      // approval is not known here, so any other call is refused.
      const turn = state.turns.findLast((t) =>
        t.content.some((b) => b.type === "tool_call" && b.id === call.id),
      );
      if (turn === undefined) {
        throw new Error(`Question call ${call.id} is in no assistant turn`);
      }
      if (turn.content.filter((b) => b.type === "tool_call").length > 1) {
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
              ...prompt,
            })),
          },
        },
      };
    },
  };
}

/**
 * A screen the host parks a call on, and what the person's answer does:
 * "result" makes it the call's result, "rerun" runs the parked call once.
 */
export type CallPause = QuestionScreen & { resume: "result" | "rerun" };

/**
 * Asks the host about a call before it runs: undefined runs it, refusal text
 * blocks it with that text as its result, and a screen parks it like a
 * question, with the person's `{ output }` or `{ reply }` as its result.
 * It runs after authz, so a call that needs approval and shares its reply
 * with other calls is refused as a screen only after the person approved it.
 */
export type CallCheck = (
  call: ToolCall,
) => Promise<CallPause | string | undefined>;

export function createCallCheckExtension(
  checkCall: CallCheck,
): BeforeToolExtension {
  // A call re-run after the person answered its screen runs without asking
  // the host again; see `grantOneShot`.
  const answered = new Set<string>();
  return {
    grantOneShot(id) {
      answered.add(id);
    },
    async beforeTool(call, state) {
      if (answered.delete(call.id)) return { type: "allow" };
      const decision = await checkCall(call);
      if (decision === undefined) return { type: "allow" };
      if (typeof decision === "string") {
        return { type: "block", reason: decision };
      }
      const { resume, ...asked } = decision;
      const screen = QuestionScreen(asked);
      if (screen instanceof type.errors) {
        return { type: "block", reason: `Invalid screen: ${screen.summary}` };
      }
      // A parked call waits alone in its reply, as a question does.
      const turn = state.turns.findLast((t) =>
        t.content.some((b) => b.type === "tool_call" && b.id === call.id),
      );
      if (turn === undefined) {
        throw new Error(`Parked call ${call.id} is in no assistant turn`);
      }
      if (turn.content.filter((b) => b.type === "tool_call").length > 1) {
        return {
          type: "block",
          reason:
            "A call that shows a screen must be the only tool call in its reply. Make it on its own in your next reply.",
        };
      }
      const correlationId = crypto.randomUUID();
      const gateId = `pending-${correlationId}`;
      const pendingOp: PendingOperation = {
        correlationId,
        kind: "question",
        registeredAt: Date.now(),
        gateId,
        suspendedCall: call,
        question: screen,
      };
      if (resume === "rerun") pendingOp.rerun = true;
      return {
        type: "suspend",
        gate: { type: "question", gateId, correlationId },
        pendingOp,
      };
    },
  };
}
