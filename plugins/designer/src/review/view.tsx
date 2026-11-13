/**
 * The mockup review: the design's mockup in the host's sandboxed frame with a numbered pin on each
 * place the person tagged, their comments beside it, and a bar to move between screens and tag a
 * place. The host answers it from the screen's decision: approve, or send the comments back.
 * Settles to one line in the conversation once answered.
 */
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentType,
  type Ref,
} from "react";
import { MapPin, Monitor, Smartphone, X } from "lucide-react";
import { Button, Textarea } from "@corbits/react-ui";
import type { Offer, ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import { ScreenSettled } from "@corbits-builder/plugin-ui/screen-card";
import { Output, type At, type Comment, type Input } from "./schema.ts";
import styles from "./view.module.css";

type Device = "desktop" | "phone";
type Place = { screen: string; state: string | null };
type Tagged = typeof At.infer;
type Said = typeof Comment.infer;

export type FrameHandle = { go(place: Place): void };

/** Where in the tagged element the click fell, and the element's own short name, if it has one. */
export type Spot = {
  spot: [number, number];
  point: [number, number];
  name?: string;
};

/** A numbered pin the frame draws over a tagged place, and the name it reads out. */
export type FramePin = {
  number: number;
  label: string;
  selected: boolean;
  testid?: string;
  id?: string;
  spot: Spot["spot"];
  point: Spot["point"];
};

/** The host's frame around a design bundle, and the messages it passes back from it. */
export type FrameProps = {
  files: Readonly<Record<string, string>>;
  device: Device;
  tagging: boolean;
  onScreens(
    screens: readonly { screen: string; states: readonly string[] }[],
  ): void;
  onShown(shown: Place | null): void;
  onTag(at: Tagged, spot: Spot): void;
  pins?: readonly FramePin[];
  onPin?(pin: number): void;
  ref?: Ref<FrameHandle>;
};

/** The design to review, and the design option an approval of it chooses, if any. */
export type ReviewedDesign = {
  files: Readonly<Record<string, string>>;
  version: number | "draft";
  approval: { option: string } | { unavailable: string };
};

export type Host = {
  design: ReviewedDesign | null;
  mockupFrame: ComponentType<FrameProps>;
  earlierAnswer: unknown;
};

type ReviewOutput = typeof Output.infer;
type Props = ScreenViewProps<
  typeof Input.infer,
  ReviewOutput,
  typeof Input.infer,
  Host
>;

const plural = (count: number) =>
  count === 1 ? "1 comment" : `${String(count)} comments`;

export const text = {
  title: "Review the mockup",
  screen: "Screen",
  viewport: "Viewport",
  desktop: "Desktop",
  phone: "Phone",
  tag: "Tag",
  startHint: "Turn on Tag, then click a place in the mockup to pin a comment.",
  tagHint: "Click a place to pin a comment.",
  comments: "Comments",
  noComments: "No comments yet.",
  lastRound: "Last round",
  commentOn: (pin: number) => `Comment on pin ${String(pin)}`,
  placeholder: "What should change here?",
  add: "Add",
  cancel: "Cancel",
  remove: (pin: number) => `Remove comment ${String(pin)}`,
  pin: (pin: number, said: string | undefined) =>
    said === undefined ? `Pin ${String(pin)}` : `Pin ${String(pin)}: ${said}`,
  noDesign: "There is no design to review yet.",
  asked: "Approve the design?",
  approved: (version: number | "draft") =>
    version === "draft"
      ? "Approved the draft"
      : `Approved, version ${String(version)}`,
  changes: (count: number) =>
    count === 0 ? "Asked for changes" : `Sent ${plural(count)} instead`,
};

const placeName = ({ screen, state }: Place) =>
  state === null ? screen : `${screen} / ${state}`;

/** A comment and where its pin sits. Its number is its place in the list, from 1. */
export type Pin = { comment: Said; spot: Spot };

/** The pins made so far, the one being written, and the one selected, by number. */
export type Pins = {
  pins: readonly Pin[];
  writing: { at: Tagged; spot: Spot; words: string } | null;
  selected: number | null;
};

export type PinEvent =
  | { kind: "tag"; at: Tagged; spot: Spot }
  | { kind: "write"; words: string }
  | { kind: "add" }
  | { kind: "cancel" }
  | { kind: "remove"; pin: number }
  | { kind: "select"; pin: number };

export const NO_PINS: Pins = { pins: [], writing: null, selected: null };

/** The pins with the one being written added, when it has words. */
const withWritten = ({ pins, writing }: Pins): readonly Pin[] => {
  const words = writing?.words.trim() ?? "";
  if (writing === null || words.length === 0) return pins;
  return [
    ...pins,
    { comment: { text: words, at: writing.at }, spot: writing.spot },
  ];
};

// A comment needs words: the designer acts on what the person asks, and a bare pin asks nothing.
export function pinned(state: Pins, event: PinEvent): Pins {
  switch (event.kind) {
    case "tag": {
      // Tagging elsewhere keeps the comment being written, if it has words, and drops an empty pin.
      const pins = withWritten(state);
      return {
        pins,
        writing: { at: event.at, spot: event.spot, words: "" },
        selected: pins.length + 1,
      };
    }
    case "write":
      return state.writing === null
        ? state
        : {
            pins: state.pins,
            writing: {
              at: state.writing.at,
              spot: state.writing.spot,
              words: event.words,
            },
            selected: state.selected,
          };
    case "add": {
      const pins = withWritten(state);
      if (pins === state.pins) return state;
      return { pins, writing: null, selected: pins.length };
    }
    case "cancel":
      return { pins: state.pins, writing: null, selected: null };
    case "remove":
      return {
        pins: state.pins.filter((_, index) => index !== event.pin - 1),
        writing: state.writing,
        selected: null,
      };
    case "select":
      return { pins: state.pins, writing: state.writing, selected: event.pin };
  }
}

/** Every comment that goes to the designer, the one being written included once it has words. */
export const outgoing = (state: Pins): Said[] =>
  withWritten(state).map(({ comment }) => comment);

const onPlace = (at: Tagged, shown: Place | null) =>
  shown !== null &&
  at.screen === shown.screen &&
  (at.state ?? null) === shown.state;

/** The pins the frame draws: those on the screen and state it shows, numbered as listed. */
export function framePins(state: Pins, shown: Place | null): FramePin[] {
  const drawn = state.pins.map(({ comment, spot }, index) => ({
    number: index + 1,
    at: comment.at,
    said: comment.text,
    spot,
  }));
  if (state.writing !== null)
    drawn.push({
      number: state.pins.length + 1,
      at: state.writing.at,
      said: "",
      spot: state.writing.spot,
    });
  return drawn
    .filter(({ at }) => onPlace(at, shown))
    .map(({ number, at, said, spot }) => {
      const pin: FramePin = {
        number,
        label: text.pin(number, said.length === 0 ? undefined : said),
        selected: number === state.selected,
        spot: spot.spot,
        point: spot.point,
      };
      if (at.testid !== undefined) pin.testid = at.testid;
      else if (at.id !== undefined) pin.id = at.id;
      return pin;
    });
}

/** What the review offers the host: approving the design with the comments, or sending them back. */
export const offerOf = (
  { version, approval }: ReviewedDesign,
  comments: Said[],
): Offer<ReviewOutput> => ({
  accept:
    "option" in approval
      ? {
          output: {
            decision: "approved",
            version,
            option: approval.option,
            comments,
          },
        }
      : approval,
  sendBack: { decision: "changes", version, comments },
});

export function MockupReview(props: Props) {
  const { answer, host } = props;
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.asked}
        answer={
          answer.decision === "approved"
            ? text.approved(answer.version)
            : text.changes(answer.comments.length)
        }
      />
    );
  if (host === undefined || host.design === null)
    return <p className={styles.hint}>{text.noDesign}</p>;
  return <Review {...props} host={host} design={host.design} />;
}

function Review({
  input,
  offer,
  host,
  design,
}: Props & {
  host: Host;
  design: ReviewedDesign;
}) {
  const Frame = host.mockupFrame;
  const frame = useRef<FrameHandle>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [tagging, setTagging] = useState(false);
  const [places, setPlaces] = useState<readonly Place[]>([]);
  const [shown, setShown] = useState<Place | null>(null);
  const [state, dispatch] = useReducer(pinned, NO_PINS);
  const comments = useMemo(() => outgoing(state), [state]);
  const pins = useMemo(() => framePins(state, shown), [state, shown]);
  const lastRound =
    host.earlierAnswer === undefined
      ? []
      : Output.assert(host.earlierAnswer).comments;

  useEffect(() => {
    offer?.(offerOf(design, comments));
  }, [offer, design, comments]);

  const select = (pin: number) => {
    dispatch({ kind: "select", pin });
    const at = state.pins[pin - 1]?.comment.at;
    if (at?.screen !== undefined && !onPlace(at, shown))
      frame.current?.go({ screen: at.screen, state: at.state ?? null });
  };
  const shownIndex = places.findIndex(
    (place) => place.screen === shown?.screen && place.state === shown.state,
  );
  const writingPin = state.pins.length + 1;
  const canAdd = (state.writing?.words.trim().length ?? 0) > 0;

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
            pins={pins}
            onPin={select}
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
            onTag={(at, spot) => dispatch({ kind: "tag", at, spot })}
          />
        </div>
        <aside className={styles.sidebar} aria-label={text.comments}>
          {input.note === undefined ? null : (
            <p className={styles.note}>{input.note}</p>
          )}
          <p className={styles.hint} aria-live="polite">
            {tagging ? text.tagHint : text.startHint}
          </p>
          {state.writing === null ? null : (
            // Not a form: the room rings a form around its textarea as its own prompt box.
            <div
              key={writingPin}
              className={styles.compose}
              data-slot="comment-form"
            >
              <label className={styles.label} htmlFor="review-comment">
                <span className={styles.badge} aria-hidden="true">
                  {writingPin}
                </span>
                {text.commentOn(writingPin)}
                {state.writing.spot.name === undefined ? null : (
                  <span className={styles.name}>{state.writing.spot.name}</span>
                )}
              </label>
              <Textarea
                id="review-comment"
                autoFocus
                autoResize
                maxHeight={160}
                rows={2}
                maxLength={1000}
                placeholder={text.placeholder}
                value={state.writing.words}
                onChange={(event) =>
                  dispatch({ kind: "write", words: event.target.value })
                }
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  )
                    return;
                  event.preventDefault();
                  dispatch({ kind: "add" });
                }}
              />
              <div className={styles.row}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => dispatch({ kind: "cancel" })}
                >
                  {text.cancel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={canAdd ? "primary" : "outline"}
                  disabled={!canAdd}
                  onClick={() => dispatch({ kind: "add" })}
                >
                  {text.add}
                </Button>
              </div>
            </div>
          )}
          <h2 className={styles.heading}>{text.comments}</h2>
          {state.pins.length === 0 ? (
            <p className={styles.hint}>{text.noComments}</p>
          ) : (
            <ol className={styles.list} data-slot="comments">
              {state.pins.map(({ comment }, index) => (
                <li
                  key={`${String(index)}:${comment.text}`}
                  className={styles.item}
                  data-selected={state.selected === index + 1 ? "" : undefined}
                >
                  <button
                    type="button"
                    className={styles.said}
                    aria-pressed={state.selected === index + 1}
                    onClick={() => select(index + 1)}
                  >
                    <span className={styles.badge} aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>{comment.text}</span>
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={styles.remove}
                    aria-label={text.remove(index + 1)}
                    onClick={() => dispatch({ kind: "remove", pin: index + 1 })}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {lastRound.length === 0 ? null : (
            <>
              <h2 className={styles.heading}>{text.lastRound}</h2>
              <ul className={styles.list} data-slot="last-round">
                {lastRound.map((comment, index) => (
                  <li
                    key={`${String(index)}:${comment.text}`}
                    className={styles.past}
                  >
                    {comment.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <div className={styles.bar}>
        <div className={styles.controls} role="toolbar" aria-label={text.title}>
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
          <div
            className={styles.segments}
            role="group"
            aria-label={text.viewport}
          >
            <button
              type="button"
              aria-pressed={device === "desktop"}
              onClick={() => setDevice("desktop")}
            >
              <Monitor aria-hidden="true" />
              {text.desktop}
            </button>
            <button
              type="button"
              aria-pressed={device === "phone"}
              onClick={() => setDevice("phone")}
            >
              <Smartphone aria-hidden="true" />
              {text.phone}
            </button>
          </div>
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={tagging}
            onClick={() => setTagging((on) => !on)}
          >
            <MapPin aria-hidden="true" />
            {text.tag}
          </button>
        </div>
        <ScreenActions />
      </div>
    </section>
  );
}

export default MockupReview;
