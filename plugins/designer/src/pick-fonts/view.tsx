/**
 * The font picker. The fonts in use are the controls: pressing one
 * points the searchable list beneath at it, and a proposed font is one press. The main action keeps
 * the fonts until one differs, then changes them. Settles to one line once answered.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import { Badge, Button, Input } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import type { Font, Input as ScreenInput, Output } from "./schema.ts";
import styles from "./view.module.css";

type Side = "primary" | "secondary";
type Pair = Record<Side, Font | undefined>;
type Answer = typeof Output.infer;

export type Prepared = { fonts: Font[]; current: Pair; proposed: Pair };

type Props = ScreenViewProps<typeof ScreenInput.infer, Answer, Prepared>;

type List = Font["lists"][number];

// The project values, as the manifest reads them, that hold each font in use by name.
const STORED: Record<Side, string> = {
  primary: "look.font-primary",
  secondary: "look.font-secondary",
};

export const text = {
  title: "Choose your fonts",
  sides: { primary: "Primary", secondary: "Secondary" } satisfies Record<
    Side,
    string
  >,
  about:
    "Primary is for headings and body text. Secondary is only for code and figures, never headings.",
  sidesLabel: "Choosing the font for",
  notChosen: "Not chosen",
  search: "Search fonts",
  clear: "Clear search",
  noMatch: (query: string) => `No font matches “${query}”.`,
  results: (count: number) => (count === 1 ? "1 font" : `${count} fonts`),
  inUse: "In use",
  inUseNamed: (name: string) => `In use: ${name}`,
  systemFont: "the system's default font",
  was: (name: string) => `was ${name}`,
  proposed: "Proposed",
  useProposed: (name: string, side: string) =>
    `Use ${name} as ${side.toLowerCase()}`,
  paid: "Paid",
  lists: {
    sans: "Sans serif",
    serif: "Serif",
    display: "Display",
    mono: "Monospace",
  } satisfies Record<List, string>,
  hidden: (count: number) =>
    `${count} more ${count === 1 ? "font is" : "fonts are"} available with Adobe Fonts connected.`,
  missing: (sides: string) => `Choose a ${sides} font to save.`,
  keep: "Keep my fonts",
  change: "Change my fonts",
  reset: "Reset",
  saving: "Saving…",
  asked: "Which fonts?",
  kept: "Kept as they were",
  settled: (primary: string, secondary: string) =>
    `Primary ${primary}, secondary ${secondary}`,
};

// CSS's generic families, which name whatever font the system picks rather than a font.
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "math",
  "emoji",
  "fangsong",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

const order: readonly List[] = ["sans", "serif", "display", "mono"];
const sides: readonly Side[] = ["primary", "secondary"];

// Names that start with the query first, then names with a word that does, then any other match.
function rank(name: string, needle: string) {
  const lower = name.toLowerCase();
  if (lower.startsWith(needle)) return 0;
  if (lower.split(/[\s-]+/).some((word) => word.startsWith(needle))) return 1;
  if (lower.includes(needle)) return 2;
  return 3;
}

// Starts from the fonts in use; one the offered list lacks leaves its side empty.
const startFont = (prepared: Prepared, of: Side) =>
  prepared.fonts.find((font) => font.name === prepared.current[of]?.name);

/**
 * What the main action says and sends for the fonts as they stand: the fonts in use until the
 * person picks another, and nothing to send while a side has no font from the list.
 */
export function choice(prepared: Prepared, draft: Partial<Answer>) {
  const changed = sides.some(
    (of) =>
      draft[of] !== undefined && draft[of].name !== prepared.current[of]?.name,
  );
  const label = changed ? text.change : text.keep;
  const primary = draft.primary ?? startFont(prepared, "primary");
  const secondary = draft.secondary ?? startFont(prepared, "secondary");
  const missing = sides.filter(
    (of) => (draft[of] ?? startFont(prepared, of)) === undefined,
  );
  if (primary === undefined || secondary === undefined)
    return {
      changed,
      label,
      hint: text.missing(
        missing.map((of) => text.sides[of].toLowerCase()).join(" and "),
      ),
    };
  return { changed, label, answer: { primary, secondary } };
}

const announcement = (count: number, query: string) =>
  count === 0 ? text.noMatch(query) : text.results(count);

// The name the project stores for a side, which may be a font the list does not have, said as
// the person would say it.
function storedName(project: Props["project"], of: Side) {
  const name = project[STORED[of]];
  if (typeof name !== "string") return undefined;
  return GENERIC.has(name.toLowerCase()) ? text.systemFont : name;
}

export function FontPicker({
  project,
  prepared,
  facts,
  draft,
  setDraft,
  submit,
  submitting,
  answer,
}: Props) {
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.asked}
        answer={
          sides.some((of) => answer[of].name !== prepared.current[of]?.name)
            ? text.settled(answer.primary.name, answer.secondary.name)
            : text.kept
        }
      />
    );
  return (
    <Choosing
      project={project}
      prepared={prepared}
      facts={facts}
      draft={draft}
      setDraft={setDraft}
      submit={submit}
      submitting={submitting}
    />
  );
}

function Choosing({
  project,
  prepared,
  facts,
  draft,
  setDraft,
  submit,
  submitting,
}: Omit<Props, "input" | "answer">) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [side, setSide] = useState<Side>("primary");
  const [query, setQuery] = useState("");
  // -1 until the person moves through the list with the arrow keys.
  const [active, setActive] = useState(-1);

  const value = (of: Side) => draft[of] ?? startFont(prepared, of);
  const chosen = value(side);
  const outcome = choice(prepared, draft);
  // A side with no font to submit names what the project stores, which the list may not have.
  const shownFont = (of: Side) => {
    const font = value(of);
    if (font !== undefined) return font.name;
    const stored = storedName(project, of);
    return stored === undefined ? text.notChosen : text.inUseNamed(stored);
  };
  // What a changed side had when the card opened, said quietly beside its name.
  const was = (of: Side) => {
    const current = prepared.current[of];
    return current !== undefined && value(of)?.name !== current.name
      ? text.was(current.name)
      : undefined;
  };
  // A side whose font in use the list lacks has nothing to go back to.
  const resettable = sides.flatMap((of) => {
    const start = startFont(prepared, of);
    return start !== undefined && was(of) !== undefined
      ? [{ of, font: start }]
      : [];
  });
  const offers = sides.flatMap((of) => {
    const font = prepared.proposed[of];
    return font !== undefined && font.name !== prepared.current[of]?.name
      ? [{ of, font }]
      : [];
  });
  const pick = (of: Side, font: Font) =>
    setDraft(of === "primary" ? { primary: font } : { secondary: font });

  const offered = prepared.fonts.filter(
    (font) => font.needs === undefined || facts.includes(font.needs),
  );
  const needle = query.trim().toLowerCase();
  // A font in several lists is shown once, under the first list it names.
  const groups = order
    .map((list) => ({
      list,
      fonts: offered.filter((font) => font.lists[0] === list),
    }))
    .filter((group) => group.fonts.length > 0);
  const shown =
    needle === ""
      ? groups.flatMap((group) => group.fonts)
      : offered
          .map((font) => ({ font, rank: rank(font.name, needle) }))
          .filter((match) => match.rank < 3)
          .sort((a, b) => a.rank - b.rank)
          .map((match) => match.font);
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list === null || selected === null || selected === undefined) return;
    list.scrollTop =
      selected.offsetTop - (list.clientHeight - selected.offsetHeight) / 2;
  }, [side]);

  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(optionId(active))
        ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const search = (next: string) => {
    setQuery(next);
    setActive(-1);
    listRef.current?.scrollTo({ top: 0 });
  };
  const clear = () => {
    search("");
    searchRef.current?.focus();
  };
  const choose = (font: Font) => {
    if (!submitting) pick(side, font);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = shown.length - 1;
    const keys: Record<string, (() => void) | undefined> = {
      ArrowDown: () => setActive((index) => Math.min(index + 1, last)),
      ArrowUp: () => setActive((index) => Math.max(index - 1, 0)),
      Home: () => setActive(Math.min(0, last)),
      End: () => setActive(last),
      Enter: () => {
        const font = shown.length === 1 ? shown[0] : shown[active];
        if (font !== undefined) choose(font);
      },
      Escape: query === "" ? undefined : () => search(""),
    };
    const run = keys[event.key];
    if (run === undefined) return;
    event.preventDefault();
    run();
  };

  const row = (font: Font) => {
    const index = shown.indexOf(font);
    return (
      <div
        key={font.name}
        id={optionId(index)}
        role="option"
        aria-selected={font.name === chosen?.name}
        className={styles.option}
        data-active={index === active ? "" : undefined}
        // Keeps focus in the search box, where the keyboard drives the list.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setActive(index);
          choose(font);
        }}
      >
        {font.name === chosen?.name ? (
          <Check className={styles.mark} aria-hidden />
        ) : (
          <span className={styles.mark} />
        )}
        <span className={styles.name}>{font.name}</span>
        {font.name === prepared.current[side]?.name ? (
          <span className={styles.inUse}>{text.inUse}</span>
        ) : null}
        {font.license === "paid" ? (
          <Badge tone="neutral">{text.paid}</Badge>
        ) : null}
      </div>
    );
  };

  return (
    <ScreenCard
      title={text.title}
      actions={
        <ScreenActions note={outcome.hint}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || outcome.answer === undefined}
            onClick={() => {
              if (outcome.answer !== undefined) void submit(outcome.answer);
            }}
          >
            {submitting ? text.saving : outcome.label}
          </Button>
          {resettable.length === 0 ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                for (const { of, font } of resettable) pick(of, font);
              }}
            >
              {text.reset}
            </Button>
          )}
        </ScreenActions>
      }
    >
      <div className={styles.picker}>
        <p className={styles.note}>{text.about}</p>
        <div role="group" aria-label={text.sidesLabel} className={styles.sides}>
          {sides.map((of) => (
            <button
              key={of}
              type="button"
              aria-pressed={of === side}
              className={styles.side}
              onClick={() => {
                setSide(of);
                setActive(-1);
              }}
            >
              <span className={styles.sideLabel}>
                {text.sides[of]}
                <span className={styles.was}>{was(of)}</span>
              </span>
              <span className={styles.sideFont}>{shownFont(of)}</span>
            </button>
          ))}
        </div>
        {offers.length === 0 ? null : (
          <div className={styles.offers}>
            <span className={styles.offersLabel}>{text.proposed}</span>
            {offers.map(({ of, font }) => (
              <Button
                key={of}
                type="button"
                size="sm"
                variant="outline"
                className={styles.offer}
                aria-pressed={value(of)?.name === font.name}
                disabled={submitting}
                onClick={() => {
                  pick(of, font);
                  setSide(of);
                  setActive(-1);
                }}
              >
                {text.useProposed(font.name, text.sides[of])}
              </Button>
            ))}
          </div>
        )}
        <div className={styles.search}>
          <Input
            ref={searchRef}
            role="combobox"
            aria-label={`${text.search}: ${text.sides[side]}`}
            aria-expanded={shown.length > 0}
            aria-autocomplete="list"
            aria-controls={`${id}-list`}
            aria-activedescendant={
              active >= 0 && active < shown.length
                ? optionId(active)
                : undefined
            }
            placeholder={text.search}
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={onKey}
          />
          {query === "" ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={text.clear}
              onClick={clear}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <div className={styles.empty}>
            <p>{text.noMatch(query.trim())}</p>
            <Button type="button" variant="link" size="sm" onClick={clear}>
              {text.clear}
            </Button>
          </div>
        ) : (
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={text.sides[side]}
            className={styles.list}
          >
            {needle === ""
              ? groups.map((group) => (
                  <div
                    key={group.list}
                    role="group"
                    aria-labelledby={`${id}-${group.list}`}
                  >
                    <p className={styles.group} id={`${id}-${group.list}`}>
                      {text.lists[group.list]}
                    </p>
                    {group.fonts.map(row)}
                  </div>
                ))
              : shown.map(row)}
          </div>
        )}
        <p className={styles.hidden} aria-live="polite">
          {needle === "" ? "" : announcement(shown.length, query.trim())}
        </p>
        {offered.length < prepared.fonts.length ? (
          <p className={styles.note}>
            {text.hidden(prepared.fonts.length - offered.length)}
          </p>
        ) : null}
      </div>
    </ScreenCard>
  );
}

export default FontPicker;
