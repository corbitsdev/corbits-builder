/**
 * What the person must set up outside Builder, as one card in the conversation: a checklist they
 * tick as they go, with where each step's value goes, and Done once every step is ticked. It never
 * takes a value. Settles to one line once answered.
 */
import { useId } from "react";
import { Button, Checkbox } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import type { Input, Output, Step } from "./schema.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  typeof Input.infer
>;

const count = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

export const text = {
  noSecrets:
    "Builder never asks for or stores the keys and secrets these steps create.",
  needsDeployment: "Needs a deployment first",
  open: (link: string) => `Open ${new URL(link).host}`,
  // Around the setting's name, which is drawn as code.
  settingBefore: "Put the value in ",
  settingAfter:
    " in your deployment's settings, or in your own machine's environment.",
  done: "Done",
  later: "I'll do this later",
  tickEach: "Tick each step as you do it.",
  settled: (done: number, total: number, deployment: number, later: number) => {
    const parts = [`${String(done)} of ${String(total)} done`];
    if (deployment > 0)
      parts.push(count(deployment, "needs a deployment", "need a deployment"));
    if (later > 0) parts.push(`${String(later)} left for later`);
    return parts.join("; ");
  },
};

// Steps by their number in the order given, from 1.
const numbers = (steps: readonly Step[]) =>
  steps.map((_step, index) => index + 1);

export function Setup({
  input,
  draft,
  setDraft,
  submit,
  submitting,
  answer,
}: Props) {
  const all = numbers(input.steps);
  if (answer !== undefined) {
    const needsDeployment = answer.left.filter(
      (number) => input.steps[number - 1]?.needsDeployment === true,
    ).length;
    return (
      <ScreenSettled
        asked={input.title}
        answer={text.settled(
          answer.done.length,
          all.length,
          needsDeployment,
          answer.left.length - needsDeployment,
        )}
      />
    );
  }
  const ticked = draft.done ?? [];
  const tick = (number: number, checked: boolean) =>
    setDraft({
      done: checked
        ? [...ticked, number].sort((a, b) => a - b)
        : ticked.filter((each) => each !== number),
    });
  const finished = all.every((number) => ticked.includes(number));
  return (
    <ScreenCard
      title={input.title}
      actions={
        <ScreenActions note={finished ? undefined : text.tickEach}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || !finished}
            onClick={() => void submit({ done: all, left: [] })}
          >
            {text.done}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={() =>
              void submit({
                done: ticked,
                left: all.filter((number) => !ticked.includes(number)),
              })
            }
          >
            {text.later}
          </Button>
        </ScreenActions>
      }
    >
      <ol className={styles.steps} data-slot="setup">
        {input.steps.map((step, index) => (
          <SetupStep
            // The steps are fixed once asked, so their place is their identity.
            key={index}
            step={step}
            checked={ticked.includes(index + 1)}
            disabled={submitting}
            onCheckedChange={(checked) => tick(index + 1, checked)}
          />
        ))}
      </ol>
      <p className={styles.hint}>{text.noSecrets}</p>
    </ScreenCard>
  );
}

function SetupStep({
  step,
  checked,
  disabled,
  onCheckedChange,
}: {
  step: Step;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <li className={styles.step}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      <div className={styles.body}>
        <label htmlFor={id} className={styles.instruction}>
          {step.instruction}
        </label>
        {step.needsDeployment === true ? (
          <span className={styles.label}>{text.needsDeployment}</span>
        ) : null}
        {step.detail === undefined ? null : (
          <p className={styles.detail}>{step.detail}</p>
        )}
        {step.setting === undefined ? null : (
          <p className={styles.detail}>
            {text.settingBefore}
            <code className={styles.setting}>{step.setting}</code>
            {text.settingAfter}
          </p>
        )}
        {step.link === undefined ? null : (
          <a
            className={styles.link}
            href={step.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            {text.open(step.link)}
          </a>
        )}
      </div>
    </li>
  );
}

export default Setup;
