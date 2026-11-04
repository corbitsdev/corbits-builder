import { Badge, Button } from "@corbits/react-ui";
import {
  ApprovalPackageBundle,
  type ApprovalPackageSource,
} from "@corbits-builder/schemas/artifact";
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
import { type } from "arktype";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { wording } from "../../config.ts";
import { Markdown } from "../../markdown.jsx";

export const APPROVAL_PACKAGE_MEDIA_TYPE =
  "application/vnd.corbits-builder.approval-package+json";

const text = wording.approvalPackage;

export type ApprovalPackageViewTab = "slides" | "pdf" | "sources";

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

export function parseApprovalPackage(
  content: string,
): ApprovalPackageBundle | null {
  try {
    const parsed: unknown = JSON.parse(content);
    const result = ApprovalPackageBundle(parsed);
    if (result instanceof type.errors) return null;
    return result;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

/** The package's PDF as a file, or null when its base64 does not decode. */
export function approvalPackagePdfFile(
  stem: string,
  bundle: ApprovalPackageBundle,
): File | null {
  const dataUrlMatch = /^data:[^;,]*;base64,(.*)$/s.exec(bundle.pdfBase64);
  const encoded = (
    dataUrlMatch === null ? bundle.pdfBase64 : (dataUrlMatch[1] as string)
  ).replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(encoded);
  } catch (error) {
    if (
      !(error instanceof DOMException && error.name === "InvalidCharacterError")
    )
      throw error;
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], `${stem}.pdf`, { type: "application/pdf" });
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
        {renderList(item.items, item.ordered === true)}
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
    <div className="approval-package-slide-body">
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
    <div className="approval-package-column">
      {heading === undefined ? null : (
        <h4
          className="approval-package-column-heading"
          style={{ color: headingColor }}
        >
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
  return <div className="approval-package-slide-body">{paragraphs}</div>;
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
        <div className="approval-package-columns">
          <SlideColumn blocks={slide.left} headingColor={headingColor} />
          <SlideColumn blocks={slide.right} headingColor={headingColor} />
        </div>
      );
    case "comparison":
      return (
        <div className="approval-package-columns">
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
      className="approval-package-slide-stage"
      style={slideStageStyle(theme, palette)}
      data-slide-layout={slide.layout}
      data-slide-tone={palette.isDark ? "dark" : "light"}
    >
      <div
        className="approval-package-slide-accent-bar"
        style={{ backgroundColor: palette.accentBar }}
        aria-hidden="true"
      />
      <div className="approval-package-slide-canvas">
        {title === undefined && subtitle === undefined ? null : (
          <header className="approval-package-slide-heading">
            {slide.layout === "title" ? (
              <span
                className="approval-package-slide-kicker"
                style={{ backgroundColor: palette.accentBar }}
                aria-hidden="true"
              />
            ) : null}
            {title === undefined ? null : (
              <h3
                className="approval-package-slide-title"
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
                className="approval-package-slide-subtitle"
                style={{ color: palette.subtitle }}
              >
                {subtitle}
              </p>
            )}
          </header>
        )}
        <SlideContent slide={slide} headingColor={palette.columnHeading} />
        {caption === undefined ? null : (
          <p
            className="approval-package-slide-caption"
            style={{ color: palette.subtitle }}
          >
            {caption}
          </p>
        )}
      </div>
      <footer
        className="approval-package-slide-stage-footer"
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
    <article
      className="approval-package-slide"
      data-slide-layout={slide.layout}
    >
      <div className="approval-package-slide-meta">
        <span className="approval-package-slide-index">
          {text.slideCount(index + 1, total)}
        </span>
        <Badge tone="neutral">{slide.layout}</Badge>
      </div>
      <SlideCanvas slide={slide} index={index} total={total} theme={theme} />
    </article>
  );
}

function DeckSlides({ deck }: { deck: Deck }) {
  return (
    <div className="approval-package-slides">
      {deck.slides.map((slide, index) => (
        <SlideCard
          key={index}
          slide={slide}
          index={index}
          total={deck.slides.length}
          theme={deck.theme}
        />
      ))}
    </div>
  );
}

export function SlidesView({ deck }: { deck: Record<string, unknown> }) {
  const readable = readDeck(deck);
  if (readable === null) {
    return <p className="inline-note">{text.unreadable}</p>;
  }
  return <DeckSlides deck={readable} />;
}

// Chromium and Brave block data:application/pdf URLs inside <iframe>;
// rendering 16:9 print sheets with a blob-backed download avoids browser blocking.
function PdfView({
  bundle,
  deck,
  stem,
}: {
  bundle: ApprovalPackageBundle;
  deck: Deck;
  stem: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const file = useMemo(
    () => approvalPackagePdfFile(stem, bundle),
    [stem, bundle],
  );
  useEffect(() => {
    if (
      file === null ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setBlobUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const dataUrlMatch = /^data:[^;,]*;base64,(.*)$/s.exec(bundle.pdfBase64);
  const fallbackHref =
    dataUrlMatch === null
      ? `data:application/pdf;base64,${bundle.pdfBase64}`
      : bundle.pdfBase64;
  const pdfHref = blobUrl ?? fallbackHref;

  return (
    <div className="approval-package-pdf" aria-label={text.pdfTitle}>
      <div className="approval-package-pdf-toolbar">
        <div className="approval-package-pdf-toolbar-meta">
          <strong className="approval-package-pdf-title">
            {text.pdfTitle}
          </strong>
          <span className="approval-package-pdf-filename">{stem}.pdf</span>
        </div>
        {file === null ? (
          <p className="inline-note">{text.pdfUnreadable}</p>
        ) : (
          <div className="approval-package-pdf-toolbar-actions">
            {blobUrl !== null && (
              <a
                className="approval-package-pdf-action"
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {text.openPdf}
              </a>
            )}
            <a
              className="approval-package-pdf-action approval-package-pdf-action-primary"
              href={pdfHref}
              download={`${stem}.pdf`}
            >
              {text.downloadPdf}
            </a>
          </div>
        )}
      </div>
      <div className="approval-package-pdf-pages">
        {deck.slides.map((slide, index) => (
          <div key={index} className="approval-package-pdf-page">
            <SlideCanvas
              slide={slide}
              index={index}
              total={deck.slides.length}
              theme={deck.theme}
              pageFooter={text.pageCount(index + 1, deck.slides.length)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceRow({
  source,
  onOpenSource,
}: {
  source: ApprovalPackageSource;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
}) {
  const kindLabel = wording.documentTab[source.kind] ?? source.kind;
  return (
    <tr>
      <td>
        <button
          type="button"
          className="approval-package-source-link"
          onClick={() => onOpenSource?.(source.kind, source.version)}
        >
          {kindLabel}
        </button>
      </td>
      <td>
        <button
          type="button"
          className="approval-package-source-link"
          onClick={() => onOpenSource?.(source.kind, source.version)}
        >
          {source.title}
        </button>
      </td>
      <td>
        <button
          type="button"
          className="approval-package-source-link approval-package-source-version"
          onClick={() => onOpenSource?.(source.kind, source.version)}
        >
          v{String(source.version)}
        </button>
      </td>
      <td>
        <code>{source.sha256.slice(0, 12)}</code>
      </td>
    </tr>
  );
}

function SourcesView({
  bundle,
  onOpenSource,
}: {
  bundle: ApprovalPackageBundle;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
}) {
  const { manifest, documents } = bundle;
  const hasDocuments =
    documents !== undefined && Object.keys(documents).length > 0;
  return (
    <div className="approval-package-sources">
      <dl className="approval-package-manifest">
        <div>
          <dt>{text.manifest.audience}</dt>
          <dd>{manifest.audience}</dd>
        </div>
        <div>
          <dt>{text.manifest.decisionNeeded}</dt>
          <dd>{manifest.decisionNeeded}</dd>
        </div>
        <div>
          <dt>{text.manifest.tone}</dt>
          <dd>{manifest.tone}</dd>
        </div>
        <div>
          <dt>{text.manifest.length}</dt>
          <dd>{manifest.length}</dd>
        </div>
      </dl>
      <section aria-label={text.manifest.sources}>
        <h3>{text.manifest.sources}</h3>
        <table className="approval-package-sources-table">
          <thead>
            <tr>
              <th scope="col">{text.manifest.sourceKind}</th>
              <th scope="col">{text.manifest.sourceTitle}</th>
              <th scope="col">{text.manifest.sourceVersion}</th>
              <th scope="col">{text.manifest.sourceHash}</th>
            </tr>
          </thead>
          <tbody>
            {manifest.sources.map((source) => (
              <SourceRow
                key={`${source.artifactId}:${String(source.version)}`}
                source={source}
                onOpenSource={onOpenSource}
              />
            ))}
          </tbody>
        </table>
      </section>
      {hasDocuments ? (
        <section aria-label={text.manifest.documents}>
          <h3>{text.manifest.documents}</h3>
          <div className="approval-package-documents-list">
            {Object.entries(documents).map(([name, docContent]) => (
              <article key={name} className="approval-package-document">
                <h4>{name}</h4>
                <Markdown source={docContent} />
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ApprovalPackagePreview({
  content,
  stem = "approval-package",
  initialTab = "slides",
  onOpenSource,
}: {
  content: string;
  stem?: string;
  initialTab?: ApprovalPackageViewTab;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
}) {
  const [activeTab, setActiveTab] =
    useState<ApprovalPackageViewTab>(initialTab);
  const bundle = parseApprovalPackage(content);
  const deck = bundle === null ? null : readDeck(bundle.deck);
  if (bundle === null || deck === null) {
    return <p className="inline-note">{text.unreadable}</p>;
  }
  return (
    <section className="approval-package" aria-label={text.label}>
      <div
        className="approval-package-tabs"
        role="tablist"
        aria-label={text.viewLabel}
      >
        <Button
          role="tab"
          size="sm"
          variant="ghost"
          className="approval-package-subtab"
          aria-selected={activeTab === "slides"}
          onClick={() => setActiveTab("slides")}
        >
          {text.tabs.slides}
        </Button>
        <Button
          role="tab"
          size="sm"
          variant="ghost"
          className="approval-package-subtab"
          aria-selected={activeTab === "pdf"}
          onClick={() => setActiveTab("pdf")}
        >
          {text.tabs.pdf}
        </Button>
        <Button
          role="tab"
          size="sm"
          variant="ghost"
          className="approval-package-subtab"
          aria-selected={activeTab === "sources"}
          onClick={() => setActiveTab("sources")}
        >
          {text.tabs.sources}
        </Button>
      </div>
      {activeTab === "slides" ? <DeckSlides deck={deck} /> : null}
      {activeTab === "pdf" ? (
        <PdfView bundle={bundle} deck={deck} stem={stem} />
      ) : null}
      {activeTab === "sources" ? (
        <SourcesView bundle={bundle} onOpenSource={onOpenSource} />
      ) : null}
    </section>
  );
}
