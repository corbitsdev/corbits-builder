const NAMES = new Set(["toolReplay", "replay"]);
const MESSAGE =
  "Only tests set tool replay: it makes the hub answer tools from recordings.";

type Name = { name?: string; value?: unknown };
type Operand = Name & { type?: string; property?: Name };
type Node = {
  key?: Name;
  left?: Operand;
  right?: Operand;
  operator?: string;
};
type Context = { report: (report: { node: Node; message: string }) => void };

const named = (name: Name | undefined) =>
  NAMES.has(String(name?.name ?? name?.value));

const ENDED = new Set(["skipped", "cancelled"]);
const PLAN_STATE_MESSAGE =
  "Read a plan step's finished mark, or a rule from @corbits-builder/schemas/plan, rather than testing its state for skipped or cancelled.";
// `state`, or anything's `.state`.
const isState = (operand: Operand | undefined) =>
  operand?.name === "state" || operand?.property?.name === "state";
const isEnded = (operand: Operand | undefined) =>
  operand?.type === "Literal" && ENDED.has(String(operand.value));

export default {
  meta: { name: "corbits-builder" },
  rules: {
    // A hub given a replay module answers tools from recordings instead of running them, so only
    // tests pass one. It is off in test/, and app.ts's one line that takes it disables it inline.
    "no-tool-replay": {
      create: (context: Context) => ({
        Property(node: Node) {
          if (named(node.key)) context.report({ node, message: MESSAGE });
        },
        AssignmentExpression(node: Node) {
          if (named(node.left?.property))
            context.report({ node, message: MESSAGE });
        },
      }),
    },
    // Whether plan work is finished is decided once, in the plan schemas, and read from there; a
    // second test of a step's state for skipped or cancelled is a second copy of that rule.
    "no-plan-state-check": {
      create: (context: Context) => ({
        BinaryExpression(node: Node) {
          if (node.operator !== "===" && node.operator !== "!==") return;
          const { left, right } = node;
          if (
            (isState(left) && isEnded(right)) ||
            (isState(right) && isEnded(left))
          )
            context.report({ node, message: PLAN_STATE_MESSAGE });
        },
      }),
    },
  },
};
