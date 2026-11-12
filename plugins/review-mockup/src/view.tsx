/**
 * The mockup review as the page draws it: the design's mockup in the host's sandboxed frame, the
 * person's comments beside it, and a bar to move between screens, tag a place, approve or send.
 * Settles to one line in the conversation once answered.
 */
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type Ref,
} from "react";
import { Button } from "@corbits/react-ui";
import type { PageControls, ScreenViewProps } from "@corbits-builder/plugin";
import { Output, type At, type Comment, type Input } from "./schema.ts";
import styles from "./view.module.css";

type Device = "desktop" | "phone";
type Place = { screen: string; state: string | null };

export type FrameHandle = { go(place: Place): void };

/** The host's frame around a design bundle, and the messages it passes back from it. */
export type FrameProps = {
  files: Readonly<Record<string, string>>;
  device: Device;
  tagging: boolean;
  onScreens(
    screens: readonly { screen: string; states: readonly string[] }[],
  ): void;
  onShown(shown: Place | null): void;
  onTag(at: typeof At.infer): void;
  ref?: Ref<FrameHandle>;
};

/** The design to review, and whether the host can record the person's approval of it. */
export type ReviewedDesign = {
  files: Readonly<Record<string, string>>;
  version: number | "draft";
  approval: { approve(): Promise<void> } | { unavailable: string };
};

export type Host = {
  design: ReviewedDesign | null;
  mockupFrame: ComponentType<FrameProps>;
  earlierAnswer: unknown;
};

type ReviewOutput = typeof Output.infer;
const NONE: (typeof Comment.infer)[] = [];
type Props = ScreenViewProps<
  typeof Input.infer,
  ReviewOutput,
  typeof Input.infer,
  Host
>;

export const text = {
  title: "Review the mockup",
  screen: "Screen",
  desktop: "Desktop",
  phone: "Phone",
  tag: "Tag",
  tagHint: "Click a place in the mockup to comment on it.",
  approve: "Approve",
  sendFeedback: "Send feedback",
  close: "Close",
  comments: "Comments",
  noComments: "No comments yet.",
  lastRound: "Last round",
  commentOn: "Comment on",
  add: "Add",
  cancel: "Cancel",
  remove: "Remove",
  noDesign: "There is no design to review yet.",
  notApproved: "The design was not approved. Try again.",
  approved: (version: number | "draft") =>
    `Approved the design, version ${String(version)}.`,
  changes: (count: number) =>
    count === 1
      ? "Sent 1 comment on the mockup."
      : `Sent ${String(count)} comments on the mockup.`,
};

const placeName = ({ screen, state }: Place) =>
  state === null ? screen : `${screen} / ${state}`;

/** Where a comment points, in the mockup's own names. */
export const where = (at: typeof At.infer) =>
  [at.screen, at.state, at.testid ?? at.id ?? at.tag]
    .filter((part) => part !== undefined)
    .join(" · ");

const changes = (
  version: ReviewOutput["version"],
  comments: (typeof Comment.infer)[],
  message: string | undefined,
): ReviewOutput => {
  const output: ReviewOutput = { decision: "changes", version, comments };
  if (message !== undefined) output.message = message;
  return output;
};

export function MockupReview(props: Props) {
  const { answer, host } = props;
  if (answer !== undefined)
    return (
      <p className={styles.settled}>
        {answer.decision === "approved"
          ? text.approved(answer.version)
          : text.changes(answer.comments.length)}
      </p>
    );
  if (host === undefined || host.design === null || props.page === undefined)
    return <p className={styles.settled}>{text.noDesign}</p>;
  return (
    <Review {...props} host={host} design={host.design} page={props.page} />
  );
}

function Review({
  input,
  draft,
  setDraft,
  submit,
  submitting,
  host,
  design,
  page,
}: Props & {
  host: Host;
  design: ReviewedDesign;
  page: PageControls<ReviewOutput>;
}) {
  const Frame = host.mockupFrame;
  const frame = useRef<FrameHandle>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [tagging, setTagging] = useState(false);
  const [places, setPlaces] = useState<readonly Place[]>([]);
  const [shown, setShown] = useState<Place | null>(null);
  const [pending, setPending] = useState<typeof At.infer | null>(null);
  const [words, setWords] = useState("");
  const [fault, setFault] = useState<string>();
  const comments = draft.comments ?? NONE;
  const { version, approval } = design;
  const lastRound =
    host.earlierAnswer === undefined
      ? []
      : Output.assert(host.earlierAnswer).comments;

  useEffect(() => {
    page.stage(
      comments.length === 0
        ? null
        : (message) => changes(version, comments, message),
    );
    return () => page.stage(null);
  }, [page, comments, version]);

  const approve = async (record: () => Promise<void>) => {
    setFault(undefined);
    try {
      await record();
    } catch (cause) {
      console.warn("The design was not approved.", cause);
      setFault(text.notApproved);
      return;
    }
    await submit({ decision: "approved", version, comments });
  };
  const addComment = () => {
    if (pending === null || words.trim().length === 0) return;
    setDraft({ comments: [...comments, { text: words.trim(), at: pending }] });
    setPending(null);
    setWords("");
  };
  const shownIndex = places.findIndex(
    (place) => place.screen === shown?.screen && place.state === shown.state,
  );

  return (
    <section
      className={styles.review}
      data-slot="mockup-review"
      aria-label={text.title}
    >
      <div className={styles.body}>
        <div className={styles.stage}>
          <Frame
            ref={frame}
            files={design.files}
            device={device}
            tagging={tagging}
            onScreens={(screens) =>
              setPlaces(
                screens.flatMap(({ screen, states }): Place[] =>
                  states.length === 0
                    ? [{ screen, state: null }]
                    : states.map((state) => ({ screen, state })),
                ),
              )
            }
            onShown={setShown}
            onTag={(at) => {
              setPending(at);
              setWords("");
            }}
          />
        </div>
        <aside className={styles.sidebar} aria-label={text.comments}>
          {input.note === undefined ? null : (
            <p className={styles.note}>{input.note}</p>
          )}
          {tagging ? <p className={styles.hint}>{text.tagHint}</p> : null}
          {pending === null ? null : (
            <form
              className={styles.compose}
              data-slot="comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                addComment();
              }}
            >
              <span className={styles.where}>
                {text.commentOn} {where(pending)}
                {pending.excerpt === undefined ? null : ` “${pending.excerpt}”`}
              </span>
              <textarea
                aria-label={text.commentOn}
                value={words}
                maxLength={1000}
                onChange={(event) => setWords(event.target.value)}
              />
              <div className={styles.row}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPending(null)}
                >
                  {text.cancel}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={words.trim().length === 0}
                >
                  {text.add}
                </Button>
              </div>
            </form>
          )}
          <h2 className={styles.heading}>{text.comments}</h2>
          {comments.length === 0 ? (
            <p className={styles.hint}>{text.noComments}</p>
          ) : (
            <ul className={styles.list} data-slot="comments">
              {comments.map((comment, index) => (
                <li key={`${String(index)}:${comment.text}`}>
                  <p>{comment.text}</p>
                  <span className={styles.where}>{where(comment.at)}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        comments: comments.filter((_, at) => at !== index),
                      })
                    }
                  >
                    {text.remove}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {lastRound.length === 0 ? null : (
            <>
              <h2 className={styles.heading}>{text.lastRound}</h2>
              <ul className={styles.list} data-slot="last-round">
                {lastRound.map((comment, index) => (
                  <li key={`${String(index)}:${comment.text}`}>
                    <p>{comment.text}</p>
                    <span className={styles.where}>{where(comment.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <div className={styles.bar} role="toolbar" aria-label={text.title}>
        <select
          aria-label={text.screen}
          value={shownIndex === -1 ? "" : String(shownIndex)}
          onChange={(event) => {
            const place = places[Number(event.target.value)];
            if (place !== undefined) frame.current?.go(place);
          }}
        >
          {shownIndex === -1 ? <option value="">{text.screen}</option> : null}
          {places.map((place, index) => (
            <option key={placeName(place)} value={String(index)}>
              {placeName(place)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant={device === "desktop" ? "primary" : "outline"}
          aria-pressed={device === "desktop"}
          onClick={() => setDevice("desktop")}
        >
          {text.desktop}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={device === "phone" ? "primary" : "outline"}
          aria-pressed={device === "phone"}
          onClick={() => setDevice("phone")}
        >
          {text.phone}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tagging ? "primary" : "outline"}
          aria-pressed={tagging}
          onClick={() => setTagging((on) => !on)}
        >
          {text.tag}
        </Button>
        <span className={styles.spacer} />
        {"unavailable" in approval ? (
          <span className={styles.hint}>{approval.unavailable}</span>
        ) : null}
        {fault === undefined ? null : (
          <span className={styles.hint} role="alert">
            {fault}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting || "unavailable" in approval}
          onClick={() => {
            if ("approve" in approval) void approve(() => approval.approve());
          }}
        >
          {text.approve}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={submitting || comments.length === 0}
          onClick={page.sendStaged}
        >
          {text.sendFeedback}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={page.close}>
          {text.close}
        </Button>
      </div>
    </section>
  );
}

export default MockupReview;
