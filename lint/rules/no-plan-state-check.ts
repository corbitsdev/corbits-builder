import type { Operand, Rule } from "../rule.ts";

const ENDED: ReadonlySet<unknown> = new Set(["skipped", "cancelled"]);
// The plan's finished states; no other status in Builder pairs two of them.
const FINISHED: ReadonlySet<unknown> = new Set(["done", ...ENDED]);
const MESSAGE =
  "Read a plan step's finished mark, or a rule from @corbits-builder/plan (the plugin SDK for plugins), rather than testing its state for skipped or cancelled.";

// `state`, or anything's `.state`, `?.state` included; not `map[state]`.
const isState = (operand: Operand | undefined): boolean =>
  operand?.type === "ChainExpression"
    ? isState(operand.expression)
    : operand?.name === "state" ||
      (operand?.property?.name === "state" && operand.computed !== true);
const literal = (operand: Operand | null | undefined) =>
  operand?.type === "Literal" ? operand.value : undefined;
const isEnded = (operand: Operand | null | undefined) =>
  ENDED.has(literal(operand));

// Whether plan work is finished is decided once, in @corbits-builder/plan; a second test of a step's
// state for skipped or cancelled, or a second list of finished states, is a second copy of that rule.
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
    SwitchStatement(node) {
      if (
        isState(node.discriminant) &&
        node.cases?.some((each) => isEnded(each.test))
      )
        context.report({ node, message: MESSAGE });
    },
    ArrayExpression(node) {
      const finished = new Set(
        node.elements?.map(literal).filter((value) => FINISHED.has(value)),
      );
      if (finished.size >= 2 && [...ENDED].some((name) => finished.has(name)))
        context.report({ node, message: MESSAGE });
    },
  }),
};
export default rule;
