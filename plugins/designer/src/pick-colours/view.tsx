/**
 * The colour picker as the conversation draws it. With a proposal, the colours in use beside the
 * proposed ones; otherwise a colour input for the primary and the background colour. Settles to one
 * line once answered.
 */
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button, GateBlock } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import type { Input as ScreenInput, Output } from "./schema.ts";
import styles from "./view.module.css";

type Side = "primary" | "background";
type Pair = Record<Side, string | undefined>;

export type Prepared = { current: Pair; proposed: Pair };

type Props = ScreenViewProps<
  typeof ScreenInput.infer,
  typeof Output.infer,
  Prepared
>;

export const text = {
  title: "Choose your colours",
  sides: { primary: "Primary", background: "Background" } satisfies Record<
    Side,
    string
  >,
  about:
    "Primary is the brand colour of buttons and links; background is the page behind everything.",
  inUseNamed: (value: string) => `In use: ${value}`,
  proposedNamed: (value: string) => `Proposed: ${value}`,
  none: "None",
  useProposed: "Use these colours",
  chooseOther: "Choose something else",
  unchanged: "Choose a different colour to save.",
  missing: "Choose both colours to save.",
  save: "Save colours",
  saving: "Saving…",
  settled: (side: string, chosen: string) => `${side}: ${chosen}.`,
};

const sides: readonly Side[] = ["primary", "background"];

function Swatch({ color }: { color: string | undefined }) {
  return (
    <span
      className={styles.swatch}
      style={{ background: color ?? "transparent" }}
      aria-hidden
    />
  );
}

export function ColourPicker({
  prepared,
  draft,
  setDraft,
  submit,
  submitting,
  answer,
}: Props) {
  const [browsing, setBrowsing] = useState(false);
  if (answer !== undefined)
    return (
      <section className={styles.settled} aria-label={text.title}>
        <p className={styles.settledLine}>
          <Check className={styles.settledMark} />
          {sides
            .map((side) => text.settled(text.sides[side], answer[side]))
            .join(" ")}
        </p>
      </section>
    );
  const proposing = sides.some(
    (of) =>
      prepared.proposed[of] !== undefined &&
      prepared.proposed[of]?.toLowerCase() !==
        prepared.current[of]?.toLowerCase(),
  );
  if (proposing && !browsing)
    return (
      <Proposal
        prepared={prepared}
        submit={submit}
        submitting={submitting}
        onChooseOther={() => setBrowsing(true)}
      />
    );
  return (
    <Choosing
      prepared={prepared}
      draft={draft}
      setDraft={setDraft}
      submit={submit}
      submitting={submitting}
    />
  );
}

function Proposal({
  prepared,
  submit,
  submitting,
  onChooseOther,
}: Pick<Props, "prepared" | "submit" | "submitting"> & {
  onChooseOther: () => void;
}) {
  const primary = prepared.proposed.primary ?? prepared.current.primary;
  const background =
    prepared.proposed.background ?? prepared.current.background;
  const complete = primary !== undefined && background !== undefined;
  return (
    <GateBlock
      className={styles.card}
      gate={{ kind: "form", title: text.title }}
      footer={
        <ScreenActions note={complete ? undefined : text.missing}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={onChooseOther}
          >
            {text.chooseOther}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting || !complete}
            onClick={() => {
              if (primary !== undefined && background !== undefined)
                void submit({ primary, background });
            }}
          >
            {submitting ? text.saving : text.useProposed}
          </Button>
        </ScreenActions>
      }
    >
      <div className={styles.picker}>
        <p className={styles.note}>{text.about}</p>
        {sides.map((of) => {
          const proposed = prepared.proposed[of];
          if (proposed === undefined) return null;
          const current = prepared.current[of];
          return (
            <div key={of} className={styles.row}>
              <span className={styles.label}>{text.sides[of]}</span>
              <span className={styles.value}>
                <Swatch color={current} />
                {text.inUseNamed(current ?? text.none)}
              </span>
              <span className={styles.value}>
                <Swatch color={proposed} />
                {text.proposedNamed(proposed)}
              </span>
            </div>
          );
        })}
      </div>
    </GateBlock>
  );
}

function Choosing({
  prepared,
  draft,
  setDraft,
  submit,
  submitting,
}: Pick<Props, "prepared" | "draft" | "setDraft" | "submit" | "submitting">) {
  const id = useId();
  const value = (of: Side) => draft[of] ?? prepared.current[of];
  const primary = value("primary");
  const background = value("background");
  const changed = sides.some(
    (of) => value(of)?.toLowerCase() !== prepared.current[of]?.toLowerCase(),
  );
  let hint: string | undefined;
  if (primary === undefined || background === undefined) hint = text.missing;
  else if (!changed) hint = text.unchanged;
  return (
    <GateBlock
      className={styles.card}
      gate={{ kind: "form", title: text.title }}
      footer={
        <ScreenActions note={hint}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || hint !== undefined}
            onClick={() => {
              if (primary !== undefined && background !== undefined)
                void submit({ primary, background });
            }}
          >
            {submitting ? text.saving : text.save}
          </Button>
        </ScreenActions>
      }
    >
      <div className={styles.picker}>
        <p className={styles.note}>{text.about}</p>
        {sides.map((of) => {
          const current = prepared.current[of];
          return (
            <div key={of} className={styles.row}>
              <label className={styles.label} htmlFor={`${id}-${of}`}>
                {text.sides[of]}
              </label>
              <span className={styles.value}>
                <Swatch color={current} />
                {text.inUseNamed(current ?? text.none)}
              </span>
              <input
                id={`${id}-${of}`}
                type="color"
                value={value(of) ?? ""}
                disabled={submitting}
                onChange={(event) =>
                  setDraft(
                    of === "primary"
                      ? { primary: event.target.value }
                      : { background: event.target.value },
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </GateBlock>
  );
}

export default ColourPicker;
