/**
 * The choice between the filed design concepts as the page draws it: every concept's mockup side
 * by side in the host's sandboxed frame, one picked, a comment on any. The answer names the picked
 * concept's design option, which Builder files as the design. Settles to one line in the
 * conversation once answered.
 */
import type { ComponentType } from "react";
import { Button } from "@corbits/react-ui";
import type { PageControls, ScreenViewProps } from "@corbits-builder/plugin";
import { Comparison } from "@corbits-builder/plugin-ui/comparison";
import type { FrameProps } from "../review/view.tsx";
import type { Comment, Input, Output } from "./schema.ts";
import styles from "./view.module.css";

/** A filed concept the person can choose, and the design option choosing it approves, if any. */
export type Concept = {
  label: string;
  direction: string | undefined;
  files: Readonly<Record<string, string>>;
  version: number;
  approval: { option: string } | { unavailable: string };
};

export type Host = {
  designConcepts: readonly Concept[];
  mockupFrame: ComponentType<FrameProps>;
};

type ChooseOutput = typeof Output.infer;
const NONE: (typeof Comment.infer)[] = [];
type Props = ScreenViewProps<
  typeof Input.infer,
  ChooseOutput,
  typeof Input.infer,
  Host
>;

export const text = {
  title: "Choose a design",
  comment: "Comment",
  choose: "Choose this design",
  close: "Close",
  noConcepts: "There are no design concepts to choose from yet.",
  chosen: (concept: string) => `Chose the design ${concept}.`,
  comments: (count: number) =>
    count === 1 ? "Sent 1 comment." : `Sent ${String(count)} comments.`,
};

// The frame reports screens, the screen shown and tagged places; comparing needs none of them.
const ignore = () => undefined;

export function ConceptChoice(props: Props) {
  const { answer, host } = props;
  if (answer !== undefined)
    return (
      <p className={styles.settled}>
        {text.chosen(answer.concept)}
        {answer.comments.length === 0
          ? null
          : ` ${text.comments(answer.comments.length)}`}
      </p>
    );
  if (
    host === undefined ||
    host.designConcepts.length === 0 ||
    props.page === undefined
  )
    return <p className={styles.settled}>{text.noConcepts}</p>;
  return <Choose {...props} host={host} page={props.page} />;
}

function Choose({
  input,
  draft,
  setDraft,
  submit,
  submitting,
  host,
  page,
}: Props & { host: Host; page: PageControls<ChooseOutput> }) {
  const Frame = host.mockupFrame;
  const comments = draft.comments ?? NONE;
  const picked = host.designConcepts.find(
    (concept) => concept.label === draft.concept,
  );

  const choose = (concept: Concept, option: string) =>
    submit({
      concept: concept.label,
      option,
      version: concept.version,
      comments: comments.map((comment) => ({
        concept: comment.concept,
        text: comment.text.trim(),
      })),
    });
  const comment = (concept: string, words: string) => {
    const others = comments.filter((item) => item.concept !== concept);
    setDraft({
      comments:
        words.trim().length === 0
          ? others
          : [...others, { concept, text: words }],
    });
  };

  return (
    <section
      className={styles.choose}
      data-slot="design-choice"
      aria-label={text.title}
    >
      <div className={styles.stage}>
        {input.note === undefined ? null : (
          <p className={styles.note}>{input.note}</p>
        )}
        <Comparison
          label={text.title}
          chosen={picked?.label}
          onChoose={(label) => {
            const concept = host.designConcepts.find(
              (item) => item.label === label,
            );
            if (concept !== undefined)
              setDraft({ concept: concept.label, version: concept.version });
          }}
          disabled={submitting}
          comments={{
            label: text.comment,
            maxLength: 1000,
            text: Object.fromEntries(
              comments.map((item) => [item.concept, item.text]),
            ),
            onChange: comment,
          }}
          items={host.designConcepts.map((concept) => ({
            id: concept.label,
            title: concept.label,
            note: concept.direction,
            body: (
              <div className={styles.frame}>
                <Frame
                  files={concept.files}
                  device="desktop"
                  tagging={false}
                  onScreens={ignore}
                  onShown={ignore}
                  onTag={ignore}
                />
              </div>
            ),
          }))}
        />
      </div>
      <div className={styles.bar} role="toolbar" aria-label={text.title}>
        <span className={styles.spacer} />
        {picked !== undefined && "unavailable" in picked.approval ? (
          <span className={styles.hint}>{picked.approval.unavailable}</span>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={
            submitting ||
            picked === undefined ||
            "unavailable" in picked.approval
          }
          onClick={() => {
            if (picked === undefined) return;
            const { approval } = picked;
            if ("option" in approval) void choose(picked, approval.option);
          }}
        >
          {text.choose}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={page.close}>
          {text.close}
        </Button>
      </div>
    </section>
  );
}

export default ConceptChoice;
