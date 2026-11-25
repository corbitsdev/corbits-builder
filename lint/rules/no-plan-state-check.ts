import type { Operand, Rule } from "../rule.ts";

const ENDED = new Set(["skipped", "cancelled"]);
// The plan's finished states; no other status in Builder pairs two of them.
const FINISHED = new Set(["done", ...ENDED]);
const MESSAGE =
  "Read a plan step's finished mark, or a rule from @corbits-builder/plan, rather than testing its state for skipped or cancelled.";

// `state`, or anything's `.state`, `?.state` included.
const isState = (operand: Operand | undefined): boolean =>
  operand?.type === "ChainExpression"
    ? isState(operand.expression)
    : operand?.name === "state" || operand?.property?.name === "state";
const literal = (operand: Operand | null | undefined) =>
  operand?.type === "Literal" ? String(operand.value) : undefined;
const isEnded = (operand: Operand | null | undefined) =>
  ENDED.has(literal(operand) ?? "");

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
        node.elements?.map(literal).filter((name) => FINISHED.has(name ?? "")),
      );
      if (finished.size >= 2 && [...ENDED].some((name) => finished.has(name)))
        context.report({ node, message: MESSAGE });
    },
  }),
};
export default rule;
