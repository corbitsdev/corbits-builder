import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
/**
 * The mockup review: the design's mockup filling the page in the host's sandboxed frame, as the
 * design pane shows it, with a numbered pin on each place the person tagged. The pane's floating
 * bar moves between screens and devices and tags a place; a pin's comment opens in the host's
 * comment card over the page. The host answers it from the screen's decision: approve, or send
 * the comments back. Settles to one line in the conversation once answered.
 */
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Info, MapPin } from "lucide-react";
import type { Offer } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenSettled,
  ScreenSettledLine,
} from "@corbits-builder/plugin-ui/screen-card";
import { Output, type At, type Comment, type Input } from "./schema.ts";
import styles from "./view.module.css";

type Device = "desktop" | "phone";
type Place = { screen: string; state: string | null };
type Tagged = typeof At.infer;
type Said = typeof Comment.infer;

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
  /** The design pane's floating bar around a frame that fills the page, and a panel over it. */
  bar?:
    | {
        onDevice(device: Device): void;
        actions: readonly BarAction[];
        overlay?: ReactNode;
      }
    | undefined;
};

/** One of the screen's own actions on the host's bar, after the mockup's screens and devices. */
export type BarAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onSelect?: () => void;
};

/** The host's card a comment is written and kept in, as on a written page. */
export type CardProps = {
  state: "writing" | "saved";
  comment: string;
  paired?: boolean;
  onSave?: (comment: string) => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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
  commentCard: ComponentType<CardProps>;
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
  tag: "Tag a place to comment on",
  tagHint: "Click a place to pin a comment.",
  about: "About this version",
  lastRound: "Last round",
  commentOn: (pin: number) => `Comment on pin ${String(pin)}`,
  pin: (pin: number, said: string | undefined) =>
    said === undefined ? `Pin ${String(pin)}` : `Pin ${String(pin)}: ${said}`,
  noDesign: "There is no design to review yet.",
  asked: "Approve the design?",
  approved: "You approved the design",
  changes: (count: number) =>
    count === 0 ? "Asked for changes" : `Sent ${plural(count)} instead`,
};

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
  | { kind: "reword"; pin: number; words: string }
  | { kind: "select"; pin: number }
  | { kind: "close" };

export const NO_PINS: Pins = { pins: [], writing: null, selected: null };

/**
 * The pins for comments kept in the draft, as when the page is opened again. The exact spot clicked
 * lives only as long as the page, so a kept comment's pin sits at the middle of what it tagged.
 */
export const keptPins = (comments: readonly Said[]): Pins => ({
  pins: comments.map((comment) => {
    const [left, top, width, height] = comment.at.box;
    return {
      comment,
      spot: { spot: [0.5, 0.5], point: [left + width / 2, top + height / 2] },
    };
  }),
  writing: null,
  selected: null,
});

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
    case "reword": {
      const words = event.words.trim();
      if (words.length === 0) return state;
      return {
        pins: state.pins.map((pin, index) =>
          index === event.pin - 1
            ? { comment: { text: words, at: pin.comment.at }, spot: pin.spot }
            : pin,
        ),
        writing: state.writing,
        selected: state.selected,
      };
    }
    case "select":
      return { pins: state.pins, writing: state.writing, selected: event.pin };
    case "close":
      return { pins: state.pins, writing: state.writing, selected: null };
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
  const {
    answer,
    prepared: { resources: host },
  } = props;
  if (answer?.decision === "approved")
    return <ScreenSettledLine>{text.approved}</ScreenSettledLine>;
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.asked}
        answer={text.changes(answer.comments.length)}
      />
    );
  if (host === undefined || host.design === null)
    return <p className={styles.note}>{text.noDesign}</p>;
  return (
    <Review
      prepared={props.prepared}
      draft={props.draft}
      setDraft={props.setDraft}
      offer={props.offer}
      design={host.design}
    />
  );
}

function Review({
  prepared: { input, resources: host },
  draft,
  setDraft,
  offer,
  design,
}: Pick<Props, "prepared" | "draft" | "setDraft" | "offer"> & {
  design: ReviewedDesign;
}) {
  const Frame = host.mockupFrame;
  const Card = host.commentCard;
  const [device, setDevice] = useState<Device>("desktop");
  const [tagging, setTagging] = useState(false);
  const [shown, setShown] = useState<Place | null>(null);
  // The kept comment being reworded in its card, by its pin's number.
  const [editing, setEditing] = useState<number | null>(null);
  // What the designer said of this version, and the last round's comments, open from the bar.
  const [reading, setReading] = useState(false);
  const layout = useRef<{
    spots: readonly Spot[];
    writing: { index: number; spot: Spot } | null;
    selected: number | null;
  }>({ spots: [], writing: null, selected: null });
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const readPins = (comments: readonly Said[] | undefined): Pins => {
    if (comments === undefined) return NO_PINS;
    const ui = layout.current;
    const restored = keptPins(comments);
    const pins = restored.pins.map((pin, index) => ({
      comment: pin.comment,
      spot: ui.spots[index] ?? pin.spot,
    }));
    const writing = ui.writing;
    if (writing === null) return { pins, writing: null, selected: ui.selected };
    const written = pins[writing.index];
    if (written === undefined)
      return { pins, writing: null, selected: ui.selected };
    return {
      pins: pins.filter((_, index) => index !== writing.index),
      writing: {
        at: written.comment.at,
        spot: writing.spot,
        words: written.comment.text,
      },
      selected: ui.selected,
    };
  };
  const state = readPins(draft.comments);
  const dispatch = (event: PinEvent) => {
    setDraft((current) => {
      const next = pinned(readPins(current.comments), event);
      layout.current = {
        spots: next.pins.map((pin) => pin.spot),
        writing:
          next.writing === null
            ? null
            : { index: next.pins.length, spot: next.writing.spot },
        selected: next.selected,
      };
      const comments = next.pins.map((pin) => pin.comment);
      if (next.writing !== null)
        comments.push({ at: next.writing.at, text: next.writing.words });
      return { comments };
    });
    redraw();
  };
  const comments = useMemo(() => {
    if (draft.comments === undefined) return outgoing(NO_PINS);
    return draft.comments.filter((comment) => comment.text.trim().length > 0);
  }, [draft.comments]);
  const pins = framePins(state, shown);
  const lastRound =
    host.earlierAnswer === undefined
      ? []
      : Output.assert(host.earlierAnswer).comments;

  useEffect(() => {
    offer?.(offerOf(design, comments));
  }, [offer, design, comments]);

  const select = (pin: number) => {
    setEditing(null);
    if (state.selected === pin && state.writing === null)
      return dispatch({ kind: "close" });
    dispatch({ kind: "select", pin });
  };
  const writingPin = state.pins.length + 1;
  const chosen =
    state.selected === null ? undefined : state.pins[state.selected - 1];
  const about = input.note !== undefined || lastRound.length > 0;

  const label = (pin: number, name: string | undefined) => (
    <p className={styles.label}>
      <span className={styles.badge} aria-hidden="true">
        {pin}
      </span>
      {text.commentOn(pin)}
      {name === undefined ? null : <span className={styles.name}>{name}</span>}
    </p>
  );
  let overlay: ReactNode = null;
  if (state.writing !== null)
    overlay = (
      <div key={`writing:${String(writingPin)}`} className={styles.panel}>
        {label(writingPin, state.writing.spot.name)}
        <Card
          state="writing"
          comment={state.writing.words}
          onSave={(words) => {
            dispatch({ kind: "write", words });
            dispatch({ kind: "add" });
          }}
          onCancel={() => dispatch({ kind: "cancel" })}
        />
      </div>
    );
  else if (chosen !== undefined && state.selected !== null) {
    const pin = state.selected;
    overlay = (
      <div key={`pin:${String(pin)}`} className={styles.panel}>
        {label(pin, undefined)}
        <Card
          state={editing === pin ? "writing" : "saved"}
          comment={chosen.comment.text}
          paired
          onSave={(words) => {
            dispatch({ kind: "reword", pin, words });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
          onEdit={() => setEditing(pin)}
          onDelete={() => dispatch({ kind: "remove", pin })}
        />
      </div>
    );
  } else if (reading && about)
    overlay = (
      <div className={styles.panel}>
        {input.note === undefined ? null : (
          <p className={styles.note}>{input.note}</p>
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
      </div>
    );
  else if (tagging)
    overlay = (
      <p className={styles.hint} aria-live="polite">
        {text.tagHint}
      </p>
    );

  return (
    <section
      className={styles.review}
      data-slot="mockup-review"
      aria-label={text.title}
    >
      <Frame
        files={design.files}
        device={device}
        tagging={tagging}
        pins={pins}
        onPin={select}
        onScreens={() => undefined}
        onShown={setShown}
        onTag={(at, spot) => {
          setEditing(null);
          dispatch({ kind: "tag", at, spot });
        }}
        bar={{
          onDevice: setDevice,
          actions: [
            {
              id: "tag",
              label: text.tag,
              icon: <MapPin size={16} aria-hidden="true" />,
              active: tagging,
              onSelect: () => setTagging((on) => !on),
            },
            ...(about
              ? [
                  {
                    id: "about",
                    label: text.about,
                    icon: <Info size={16} aria-hidden="true" />,
                    active: reading,
                    onSelect: () => setReading((open) => !open),
                  },
                ]
              : []),
          ],
          overlay,
        }}
      />
      <ScreenActions />
    </section>
  );
}

export default MockupReview;
