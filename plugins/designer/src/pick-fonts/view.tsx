/**
 * The font picker as the conversation draws it. With a proposal, the fonts in use beside the proposed
 * ones; otherwise one searchable list, and a switch above it that says whether the list is choosing
 * the primary or the secondary font. Settles to one line once answered.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import { Badge, Button, GateBlock, Input } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import type { Font, Input as ScreenInput, Output } from "./schema.ts";
import styles from "./view.module.css";

type Side = "primary" | "secondary";
type Pair = Record<Side, Font | undefined>;

export type Prepared = { fonts: Font[]; current: Pair; proposed: Pair };

type Props = ScreenViewProps<
  typeof ScreenInput.infer,
  typeof Output.infer,
  Prepared
>;

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
  about: "Primary is for headings and text, secondary for code and figures.",
  sidesLabel: "Choosing the font for",
  notChosen: "Not chosen",
  search: "Search fonts",
  clear: "Clear search",
  noMatch: (query: string) => `No font matches “${query}”.`,
  results: (count: number) => (count === 1 ? "1 font" : `${count} fonts`),
  inUse: "In use",
  inUseNamed: (name: string) => `In use: ${name}`,
  none: "None",
  proposedNamed: (name: string) => `Proposed: ${name}`,
  useProposed: "Use these fonts",
  chooseOther: "Choose something else",
  paid: "Paid",
  lists: {
    sans: "Sans serif",
    serif: "Serif",
    display: "Display",
    mono: "Monospace",
  } satisfies Record<List, string>,
  hidden: (count: number) =>
    `${count} more ${count === 1 ? "font is" : "fonts are"} available with Adobe Fonts connected.`,
  unchanged: "Choose a different font to save.",
  missing: (sides: string) => `Choose a ${sides} font to save.`,
  save: "Save fonts",
  saving: "Saving…",
  settled: (side: string, chosen: string) => `${side}: ${chosen}.`,
};

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

// Save stays disabled only with a reason the person can read.
function saveHint(missing: readonly Side[], changed: boolean) {
  if (missing.length > 0)
    return text.missing(
      missing.map((side) => text.sides[side].toLowerCase()).join(" and "),
    );
  if (!changed) return text.unchanged;
  return undefined;
}

const announcement = (count: number, query: string) =>
  count === 0 ? text.noMatch(query) : text.results(count);

// The name the project stores for a side, which may be a font the list does not have.
function storedName(project: Props["project"], of: Side) {
  const name = project[STORED[of]];
  return typeof name === "string" ? name : undefined;
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
  const [browsing, setBrowsing] = useState(false);
  if (answer !== undefined)
    return (
      <section className={styles.settled} aria-label={text.title}>
        <p className={styles.settledLine}>
          <Check className={styles.settledMark} />
          {sides
            .map((side) => text.settled(text.sides[side], answer[side].name))
            .join(" ")}
        </p>
      </section>
    );
  const proposing = sides.some(
    (of) =>
      prepared.proposed[of] !== undefined &&
      prepared.proposed[of] !== prepared.current[of],
  );
  if (proposing && !browsing)
    return (
      <Proposal
        project={project}
        prepared={prepared}
        submit={submit}
        submitting={submitting}
        onChooseOther={() => setBrowsing(true)}
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

function Proposal({
  project,
  prepared,
  submit,
  submitting,
  onChooseOther,
}: Pick<Props, "project" | "prepared" | "submit" | "submitting"> & {
  onChooseOther: () => void;
}) {
  const primary = prepared.proposed.primary ?? prepared.current.primary;
  const secondary = prepared.proposed.secondary ?? prepared.current.secondary;
  const missing = sides.filter(
    (of) => (prepared.proposed[of] ?? prepared.current[of]) === undefined,
  );
  const hint = saveHint(missing, true);
  return (
    <GateBlock
      className={styles.card}
      gate={{ kind: "form", title: text.title }}
      footer={
        <div className={styles.footer}>
          {hint === undefined ? null : <p className={styles.hint}>{hint}</p>}
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
            disabled={submitting || hint !== undefined}
            onClick={() => {
              if (primary !== undefined && secondary !== undefined)
                void submit({ primary, secondary });
            }}
          >
            {submitting ? text.saving : text.useProposed}
          </Button>
        </div>
      }
    >
      <div className={styles.picker}>
        <p className={styles.note}>{text.about}</p>
        {sides.map((of) => {
          const proposed = prepared.proposed[of];
          if (proposed === undefined) return null;
          const inUse =
            prepared.current[of]?.name ?? storedName(project, of) ?? text.none;
          return (
            <div key={of} className={styles.compare}>
              <span className={styles.sideLabel}>{text.sides[of]}</span>
              <span>{text.inUseNamed(inUse)}</span>
              <span>{text.proposedNamed(proposed.name)}</span>
            </div>
          );
        })}
      </div>
    </GateBlock>
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

  // Starts from the fonts in use; one the offered list lacks leaves its side empty.
  const value = (of: Side) =>
    draft[of] ??
    prepared.fonts.find((font) => font.name === prepared.current[of]?.name);
  const chosen = value(side);
  const primary = value("primary");
  const secondary = value("secondary");
  const missing = sides.filter((of) => value(of) === undefined);
  const changed = sides.some(
    (of) => value(of)?.name !== prepared.current[of]?.name,
  );
  // A side with no font to submit names what the project stores, which the list may not have.
  const shownFont = (of: Side) => {
    const font = value(of);
    if (font !== undefined) return font.name;
    const stored = storedName(project, of);
    return stored === undefined ? text.notChosen : text.inUseNamed(stored);
  };
  const hint = saveHint(missing, changed);

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
    if (submitting) return;
    setDraft(side === "primary" ? { primary: font } : { secondary: font });
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
    <GateBlock
      className={styles.card}
      gate={{ kind: "form", title: text.title }}
      footer={
        <div className={styles.footer}>
          {hint === undefined ? null : <p className={styles.hint}>{hint}</p>}
          <Button
            type="button"
            size="sm"
            disabled={submitting || hint !== undefined}
            onClick={() => {
              if (primary !== undefined && secondary !== undefined)
                void submit({ primary, secondary });
            }}
          >
            {submitting ? text.saving : text.save}
          </Button>
        </div>
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
              <span className={styles.sideLabel}>{text.sides[of]}</span>
              <span className={styles.sideFont}>{shownFont(of)}</span>
            </button>
          ))}
        </div>
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
    </GateBlock>
  );
}

export default FontPicker;
