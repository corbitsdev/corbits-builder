import type {
  ChoosableConcept as Concept,
  ScreenViewProps,
} from "@corbits-builder/plugin-ui/screen";
/**
 * The choice between the filed design concepts: every concept's mockup side
 * by side in the host's sandboxed frame, one picked, a comment on any. The answer names the picked
 * concept's design option, which Builder files as the design. Settles to one line in the
 * conversation once answered.
 */
import { useContext, type ComponentType } from "react";
import { Button } from "@corbits/react-ui";

import {
  PromptAction,
  ScreenActions,
  usePromptPlaceholder,
  usePromptSend,
} from "@corbits-builder/plugin-ui/screen-actions";
import { ScreenSettled } from "@corbits-builder/plugin-ui/screen-card";
import { Comparison } from "@corbits-builder/plugin-ui/comparison";
import type { FrameProps } from "../review/view.tsx";
import type { Comment, Input, Output } from "./schema.ts";
import styles from "./view.module.css";

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
  /** The forward button once a concept is picked. */
  use: (concept: string) => `Use ${concept}`,
  /** The prompt box once a concept is picked: words sent now go with it. */
  addDetails: (concept: string) => `Add details for ${concept}…`,
  noConcepts: "There are no design concepts to choose from yet.",
  asked: "Which design?",
  chosen: (concept: string, comments: number) => {
    if (comments === 0) return concept;
    return comments === 1
      ? `${concept}, with 1 comment`
      : `${concept}, with ${String(comments)} comments`;
  },
};

// The frame reports screens, the screen shown and tagged places; comparing needs none of them.
const ignore = () => undefined;

export function ConceptChoice(props: Props) {
  const {
    answer,
    prepared: { resources: host },
  } = props;
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.asked}
        answer={text.chosen(answer.concept, answer.comments.length)}
      />
    );
  if (host === undefined || host.designConcepts.length === 0)
    return <p className={styles.hint}>{text.noConcepts}</p>;
  return (
    <Choose
      prepared={props.prepared}
      draft={props.draft}
      setDraft={props.setDraft}
      submit={props.submit}
    />
  );
}

function Choose({
  prepared: { input, resources: host },
  draft,
  setDraft,
  submit,
}: Pick<Props, "prepared" | "draft" | "setDraft" | "submit">) {
  const Frame = host.mockupFrame;
  const comments = draft.comments ?? NONE;
  const picked = host.designConcepts.find(
    (concept) => concept.label === draft.concept,
  );
  usePromptPlaceholder(
    picked === undefined ? undefined : text.addDetails(picked.label),
  );
  // Words sent from the prompt box after a pick go with it, as a comment on the concept picked.
  usePromptSend(
    picked !== undefined && "option" in picked.approval
      ? (words) => {
          if (!("option" in picked.approval)) return false;
          void choose(picked, picked.approval.option, words);
          return true;
        }
      : undefined,
  );
  // With the prompt box beneath the page, the forward action stands where Send does.
  const toBox = useContext(PromptAction);

  const choose = (concept: Concept, option: string, details?: string) =>
    submit({
      concept: concept.label,
      option,
      version: concept.version,
      comments: [
        ...comments.map((comment) => ({
          concept: comment.concept,
          text: comment.text.trim(),
        })),
        ...(details === undefined
          ? []
          : [{ concept: concept.label, text: details }]),
      ],
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

  const usable = picked !== undefined && "option" in picked.approval;
  const note =
    picked !== undefined && "unavailable" in picked.approval
      ? picked.approval.unavailable
      : undefined;
  const forward = (
    <Button
      type="button"
      size="sm"
      disabled={!usable}
      onClick={() => {
        if (picked === undefined) return;
        const { approval } = picked;
        if ("option" in approval) void choose(picked, approval.option);
      }}
    >
      {picked === undefined ? text.choose : text.use(picked.label)}
    </Button>
  );

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
      {/* With the forward action in the prompt box, the bar stands only to say why a pick can't
          be used, so no empty strip is left under the concepts. */}
      {toBox === null || note !== undefined ? (
        <div className={styles.bar}>
          <ScreenActions note={note}>
            {toBox === null ? forward : null}
          </ScreenActions>
        </div>
      ) : null}
      {/* In the box it stands only once it can be used; until then the box's own Send waits. */}
      {toBox?.(usable ? forward : null)}
    </section>
  );
}

export default ConceptChoice;
