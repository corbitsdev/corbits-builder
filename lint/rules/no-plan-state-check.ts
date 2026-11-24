import type { Operand, Rule } from "../rule.ts";

const ENDED = new Set(["skipped", "cancelled"]);
const MESSAGE =
  "Read a plan step's finished mark, or a rule from @corbits-builder/plan, rather than testing its state for skipped or cancelled.";

// `state`, or anything's `.state`.
const isState = (operand: Operand | undefined) =>
  operand?.name === "state" || operand?.property?.name === "state";
const isEnded = (operand: Operand | undefined) =>
  operand?.type === "Literal" && ENDED.has(String(operand.value));

// Whether plan work is finished is decided once, in @corbits-builder/plan; a second test of a step's
// state for skipped or cancelled is a second copy of that rule.
const rule: Rule = {
  create: (context) => ({
    BinaryExpression(node) {
      if (node.operator !== "===" && node.operator !== "!==") return;
      const { left, right } = node;
      if (
        (isState(left) && isEnded(right)) ||
        (isState(right) && isEnded(left))
      )
        context.report({ node, message: MESSAGE });
    },
  }),
};
export default rule;
