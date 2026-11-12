/**
 * What handing approvals to Builder means, with one button to hand them over and one to keep being
 * asked; while they are handed over, the offer to be asked again. Settles to one line once answered.
 */
import { Button } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import type { Input, Output } from "./schema.ts";

type Decides = (typeof Output.infer)["decides"];
type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  typeof Input.infer
>;

export const text = {
  title: "Approvals",
  handOver:
    "Builder will carry out each step of the plan without stopping to ask for your approval. You can change anything afterwards, or turn this off at any time.",
  handedOver:
    "Builder is going ahead without asking you. Turn asking back on and it will stop for your approval before each step again.",
  goAhead: "Go ahead without asking",
  keepAsking: "Keep asking me",
  askAgain: "Ask me again",
  keepGoing: "Keep going without asking",
  orWrite: "Or write below what you want instead.",
  settled: (decides: Decides) =>
    decides === "builder"
      ? "Builder goes ahead without asking you."
      : "Builder asks for your approval before each step.",
};

export function HandOver({ input, submit, submitting, answer }: Props) {
  if (answer !== undefined) return <p>{text.settled(answer.decides)}</p>;
  const asking = input.decides === "person";
  // The way the person is offered first, then staying as they are.
  const choices: readonly { label: string; decides: Decides }[] = asking
    ? [
        { label: text.goAhead, decides: "builder" },
        { label: text.keepAsking, decides: "person" },
      ]
    : [
        { label: text.askAgain, decides: "person" },
        { label: text.keepGoing, decides: "builder" },
      ];
  return (
    <section aria-label={text.title} data-slot="hand-over">
      <p>{asking ? text.handOver : text.handedOver}</p>
      <ScreenActions note={text.orWrite}>
        {choices.map(({ label, decides }, index) => (
          <Button
            key={decides}
            type="button"
            size="sm"
            variant={index === 0 ? "primary" : "outline"}
            disabled={submitting}
            onClick={() => void submit({ decides })}
          >
            {label}
          </Button>
        ))}
      </ScreenActions>
    </section>
  );
}

export default HandOver;
