import { Badge } from "@corbits/react-ui";
import {
  freeElements,
  validateDeck,
  type Block,
  type Deck,
  type FreeElement,
  type FreeRun,
  type ListItem,
  type RichText,
  type Slide,
  type Theme,
} from "@corbits/slidedeck/deck";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { InlineNote } from "../../components.tsx";
import { wording } from "../../config.ts";
import styles from "./approval-package-slides.module.css";

const text = wording.approvalPackage;

interface ResolvedSlidePalette {
  isDark: boolean;
  background: string;
  text: string;
  heading: string;
  subtitle: string;
  accentBar: string;
  columnHeading: string;
  columnBg: string;
  columnBorder: string;
}

function normalizeHex(color: string): string {
  return color.startsWith("#") ? color : `#${color}`;
}

function channelLuminance(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const raw = hex.slice(1);
  return (
    0.2126 * channelLuminance(Number.parseInt(raw.slice(0, 2), 16)) +
    0.7152 * channelLuminance(Number.parseInt(raw.slice(2, 4), 16)) +
    0.0722 * channelLuminance(Number.parseInt(raw.slice(4, 6), 16))
  );
}

function pickLightOnDark(
  color: string,
  minLum: number,
  fallback: string,
): string {
  return relativeLuminance(color) >= minLum ? color : fallback;
}

function pickDarkOnLight(
  color: string,
  maxLum: number,
  fallback: string,
): string {
  return relativeLuminance(color) <= maxLum ? color : fallback;
}

// Dark-background decks can still declare dark brand tokens for primary/secondary;
// clamping by relative luminance keeps headings and subtitles legible on the stage.
function resolveSlidePalette(theme: Theme): ResolvedSlidePalette {
  const background = normalizeHex(theme.colors.background);
  const primary = normalizeHex(theme.colors.primary);
  const secondary = normalizeHex(theme.colors.secondary);
  const accent = normalizeHex(theme.colors.accent);
  const rawText = normalizeHex(theme.colors.text);

  if (relativeLuminance(background) < 0.25) {
    const brightPrimary = pickLightOnDark(primary, 0.35, "#38bdf8");
    return {
      isDark: true,
      background,
      text: pickLightOnDark(rawText, 0.55, "#f8fafc"),
      heading: pickLightOnDark(primary, 0.55, "#f8fafc"),
      subtitle: pickLightOnDark(secondary, 0.5, "#cbd5e1"),
      accentBar: pickLightOnDark(accent, 0.25, brightPrimary),
      columnHeading: pickLightOnDark(accent, 0.35, brightPrimary),
      columnBg: "rgba(255, 255, 255, 0.055)",
      columnBorder: "rgba(255, 255, 255, 0.14)",
    };
  }

  return {
    isDark: false,
    background,
    text: pickDarkOnLight(rawText, 0.35, "#0f172a"),
    heading: pickDarkOnLight(primary, 0.45, "#0f172a"),
    subtitle: pickDarkOnLight(secondary, 0.45, "#475569"),
    accentBar: primary,
    columnHeading: pickDarkOnLight(primary, 0.45, "#0284c7"),
    columnBg: "rgba(15, 23, 42, 0.035)",
    columnBorder: "rgba(15, 23, 42, 0.1)",
  };
}

function readDeck(value: unknown): Deck | null {
  const validated = validateDeck(value);
  return validated.ok ? validated.deck : null;
}

function slideStageStyle(
  theme: Theme,
  palette: ResolvedSlidePalette,
): CSSProperties {
  const style: Record<string, string> = {
    backgroundColor: palette.background,
    color: palette.text,
    fontFamily: theme.fonts.body,
    "--slide-bg": palette.background,
    "--slide-fg": palette.text,
    "--slide-heading": palette.heading,
    "--slide-subtitle": palette.subtitle,
    "--slide-accent": palette.accentBar,
    "--slide-column-bg": palette.columnBg,
    "--slide-column-border": palette.columnBorder,
  };
  return style as CSSProperties;
}

interface Emphasis {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

function renderEmphasis(text: string, emphasis: Emphasis, key: number) {
  let node: ReactNode = text;
  if (emphasis.bold) node = <strong key={`b-${String(key)}`}>{node}</strong>;
  if (emphasis.italic) node = <em key={`i-${String(key)}`}>{node}</em>;
  if (emphasis.underline) node = <u key={`u-${String(key)}`}>{node}</u>;
  if (emphasis.strike) node = <s key={`s-${String(key)}`}>{node}</s>;
  return <span key={key}>{node}</span>;
}

function renderRichText(value: RichText): ReactNode {
  if (typeof value === "string") return value;
  return value.map((run, index) =>
    typeof run === "string"
      ? run
      : renderEmphasis(
          run.text,
          {
            bold: run.bold === true,
            italic: run.italic === true,
            underline: run.underline === true,
            strike: run.strike === true,
          },
          index,
        ),
  );
}

function renderFreeRuns(runs: readonly (string | FreeRun)[]): ReactNode {
  return runs.map((run, index) =>
    typeof run === "string"
      ? run
      : renderEmphasis(
          run.text,
          {
            bold: run.weight !== undefined && run.weight >= 600,
            italic: run.italic === true,
            underline: run.underline === true,
            strike: run.strike === true,
          },
          index,
        ),
  );
}

function renderList(items: readonly ListItem[], ordered: boolean): ReactNode {
  const rendered = items.map((item, index) => {
    if (typeof item === "string" || Array.isArray(item)) {
      return <li key={index}>{renderRichText(item)}</li>;
    }
    return (
      <li key={index}>
        {renderRichText(item.text)}
        {renderList(item.items, item.ordered ?? ordered)}
      </li>
    );
  });
  return ordered ? <ol>{rendered}</ol> : <ul>{rendered}</ul>;
}

function SlideBlock({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return <p>{renderRichText(block.text)}</p>;
    case "list":
      return renderList(block.items, block.ordered);
    default:
      return null;
  }
}

function SlideBlocks({ blocks }: { blocks: readonly Block[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className={styles.body}>
      {blocks.map((block, index) => (
        <SlideBlock key={index} block={block} />
      ))}
    </div>
  );
}

function SlideColumn({
  heading,
  blocks,
  headingColor,
}: {
  heading?: string;
  blocks: readonly Block[];
  headingColor: string;
}) {
  return (
    <div className={styles.column}>
      {heading === undefined ? null : (
        <h4 className={styles.columnHeading} style={{ color: headingColor }}>
          {heading}
        </h4>
      )}
      <SlideBlocks blocks={blocks} />
    </div>
  );
}

function FreeText({ elements }: { elements: readonly FreeElement[] }) {
  const paragraphs: ReactNode[] = [];
  for (const [element, path] of freeElements(elements, [])) {
    if (element.type !== "text") continue;
    for (const [index, paragraph] of element.paragraphs.entries()) {
      paragraphs.push(
        <p key={`${path.join(".")}-${String(index)}`}>
          {renderFreeRuns(paragraph.runs)}
        </p>,
      );
    }
  }
  if (paragraphs.length === 0) return null;
  return <div className={styles.body}>{paragraphs}</div>;
}

function SlideContent({
  slide,
  headingColor,
}: {
  slide: Slide;
  headingColor: string;
}) {
  switch (slide.layout) {
    case "content":
    case "blank":
      return <SlideBlocks blocks={slide.body} />;
    case "two-column":
      return (
        <div className={styles.columns}>
          <SlideColumn blocks={slide.left} headingColor={headingColor} />
          <SlideColumn blocks={slide.right} headingColor={headingColor} />
        </div>
      );
    case "comparison":
      return (
        <div className={styles.columns}>
          <SlideColumn
            heading={slide.left.heading}
            blocks={slide.left.body}
            headingColor={headingColor}
          />
          <SlideColumn
            heading={slide.right.heading}
            blocks={slide.right.body}
            headingColor={headingColor}
          />
        </div>
      );
    case "free":
      return <FreeText elements={slide.elements} />;
    default:
      return null;
  }
}

function SlideCanvas({
  slide,
  index,
  total,
  theme,
  pageFooter,
}: {
  slide: Slide;
  index: number;
  total: number;
  theme: Theme;
  pageFooter?: string;
}) {
  const palette = resolveSlidePalette(theme);
  const title = "title" in slide ? slide.title : undefined;
  const subtitle = "subtitle" in slide ? slide.subtitle : undefined;
  const caption = slide.layout === "image" ? slide.caption : undefined;
  return (
    <div
      className={styles.stage}
      style={slideStageStyle(theme, palette)}
      data-slide-layout={slide.layout}
      data-slide-tone={palette.isDark ? "dark" : "light"}
    >
      <div
        className={styles.accentBar}
        style={{ backgroundColor: palette.accentBar }}
        aria-hidden="true"
      />
      <div className={styles.canvas}>
        {title === undefined && subtitle === undefined ? null : (
          <header className={styles.heading}>
            {slide.layout === "title" ? (
              <span
                className={styles.kicker}
                style={{ backgroundColor: palette.accentBar }}
                aria-hidden="true"
              />
            ) : null}
            {title === undefined ? null : (
              <h3
                className={styles.title}
                style={{
                  color: palette.heading,
                  fontFamily: theme.fonts.heading,
                }}
              >
                {title}
              </h3>
            )}
            {subtitle === undefined ? null : (
              <p
                className={styles.subtitle}
                style={{ color: palette.subtitle }}
              >
                {subtitle}
              </p>
            )}
          </header>
        )}
        <SlideContent slide={slide} headingColor={palette.columnHeading} />
        {caption === undefined ? null : (
          <p className={styles.caption} style={{ color: palette.subtitle }}>
            {caption}
          </p>
        )}
      </div>
      <footer
        className={styles.stageFooter}
        style={{ color: palette.subtitle }}
      >
        <span>{pageFooter ?? `${String(index + 1)} / ${String(total)}`}</span>
      </footer>
    </div>
  );
}

function SlideCard({
  slide,
  index,
  total,
  theme,
}: {
  slide: Slide;
  index: number;
  total: number;
  theme: Theme;
}) {
  return (
    <article className={styles.slide} data-slide-layout={slide.layout}>
      <div className={styles.slideMeta}>
        <span className={styles.slideIndex}>
          {text.slideCount(index + 1, total)}
        </span>
        <Badge tone="neutral">{slide.layout}</Badge>
      </div>
      <SlideCanvas slide={slide} index={index} total={total} theme={theme} />
    </article>
  );
}

/** The package's slides as cards, or the unreadable line when the deck is not a valid slide deck. */
export function DeckSlides({ deck }: { deck: Record<string, unknown> }) {
  const readable = useMemo(() => readDeck(deck), [deck]);
  if (readable === null) {
    return <InlineNote>{text.unreadable}</InlineNote>;
  }
  return (
    <div className={styles.slides} data-slot="approval-package-slides">
      {readable.slides.map((slide, index) => (
        <SlideCard
          key={index}
          slide={slide}
          index={index}
          total={readable.slides.length}
          theme={readable.theme}
        />
      ))}
    </div>
  );
}

/** The package's slides as print sheets, or the unreadable line when the deck is not a valid slide deck. */
export function DeckPages({ deck }: { deck: Record<string, unknown> }) {
  const readable = useMemo(() => readDeck(deck), [deck]);
  if (readable === null) {
    return <InlineNote>{text.unreadable}</InlineNote>;
  }
  return (
    <div className={styles.pdfPages} data-slot="approval-package-pages">
      {readable.slides.map((slide, index) => (
        <div key={index} className={styles.pdfPage}>
          <SlideCanvas
            slide={slide}
            index={index}
            total={readable.slides.length}
            theme={readable.theme}
            pageFooter={text.pageCount(index + 1, readable.slides.length)}
          />
        </div>
      ))}
    </div>
  );
}
