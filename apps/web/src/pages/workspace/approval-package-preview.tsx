import { Badge, Button } from "@corbits/react-ui";
import {
  ApprovalPackageBundle,
  type ApprovalPackageSource,
} from "@corbits-builder/schemas/artifact";
import { type } from "arktype";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { wording } from "../../config.ts";
import { Markdown } from "../../markdown.jsx";

export const APPROVAL_PACKAGE_MEDIA_TYPE =
  "application/vnd.corbits-builder.approval-package+json";

const text = wording.approvalPackage;

export type ApprovalPackageViewTab = "slides" | "pdf" | "sources";

interface DeckThemeColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
  muted?: string;
}

interface DeckTheme {
  colors?: DeckThemeColors | undefined;
  fonts?:
    | {
        heading?: string;
        body?: string;
      }
    | undefined;
}

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

type SlideBodyBlock =
  | string
  | {
      type?: string;
      kind?: string;
      text?: unknown;
      ordered?: boolean;
      items?: unknown[];
    };

interface DeckSlide {
  layout?: string;
  title?: string;
  subtitle?: string;
  body?: string | SlideBodyBlock[];
  left?: unknown;
  right?: unknown;
  elements?: unknown[];
  caption?: string;
  notes?: string;
  speakerNotes?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHex(color: string | undefined): string | undefined {
  if (color === undefined || color.trim() === "") return undefined;
  const trimmed = color.trim();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
  return trimmed;
}

function parseHexRgb(hex: string | undefined): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (normalized === undefined) return null;
  const raw = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const r = Number.parseInt(raw.charAt(0) + raw.charAt(0), 16);
    const g = Number.parseInt(raw.charAt(1) + raw.charAt(1), 16);
    const b = Number.parseInt(raw.charAt(2) + raw.charAt(2), 16);
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}

function channelLuminance(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string | undefined): number | null {
  const rgb = parseHexRgb(hex);
  if (rgb === null) return null;
  return (
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2])
  );
}

function pickLightOnDark(
  color: string | undefined,
  minLum: number,
  fallback: string,
): string {
  if (color === undefined) return fallback;
  const lum = relativeLuminance(color);
  return lum !== null && lum >= minLum ? color : fallback;
}

function pickDarkOnLight(
  color: string | undefined,
  maxLum: number,
  fallback: string,
): string {
  if (color === undefined) return fallback;
  const lum = relativeLuminance(color);
  return lum !== null && lum <= maxLum ? color : fallback;
}

// Dark-background decks can still declare dark brand tokens for primary/secondary;
// clamping by relative luminance keeps headings and subtitles legible on the stage.
function resolveSlidePalette(theme: DeckTheme): ResolvedSlidePalette {
  const colors = theme.colors;
  const rawBg = normalizeHex(colors?.background);
  const bgLum = relativeLuminance(rawBg);
  const isDark = bgLum !== null && bgLum < 0.25;

  const primary = normalizeHex(colors?.primary);
  const secondary = normalizeHex(colors?.secondary ?? colors?.muted);
  const accent = normalizeHex(colors?.accent ?? colors?.primary);
  const rawText = normalizeHex(colors?.text);

  if (isDark) {
    const brightPrimary = pickLightOnDark(primary, 0.35, "#38bdf8");
    return {
      isDark: true,
      background: rawBg === undefined ? "#0f172a" : rawBg,
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
    background: rawBg === undefined ? "#ffffff" : rawBg,
    text: pickDarkOnLight(rawText, 0.35, "#0f172a"),
    heading: pickDarkOnLight(primary, 0.45, "#0f172a"),
    subtitle: pickDarkOnLight(secondary, 0.45, "#475569"),
    accentBar: primary ?? accent ?? "#0284c7",
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

export function approvalPackagePdfFile(
  stem: string,
  bundle: ApprovalPackageBundle,
): File {
  const dataUrlMatch = /^data:[^;,]*;base64,(.*)$/s.exec(bundle.pdfBase64);
  const encoded = (
    dataUrlMatch === null ? bundle.pdfBase64 : (dataUrlMatch[1] as string)
  ).replace(/\s+/g, "");
  let bytes = new Uint8Array(0);
  try {
    const binary = atob(encoded);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    bytes = new Uint8Array(0);
  }
  return new File([bytes], `${stem}.pdf`, { type: "application/pdf" });
}

function readDeckTheme(deck: Record<string, unknown>): DeckTheme {
  const rawTheme = deck["theme"];
  if (!isRecord(rawTheme)) {
    return { colors: undefined, fonts: undefined };
  }
  const colors = isRecord(rawTheme["colors"])
    ? (rawTheme["colors"] as DeckThemeColors)
    : undefined;
  const fonts = isRecord(rawTheme["fonts"])
    ? (rawTheme["fonts"] as DeckTheme["fonts"])
    : undefined;
  return { colors, fonts };
}

function readDeckSlides(deck: Record<string, unknown>): DeckSlide[] {
  const rawSlides = deck["slides"];
  if (!Array.isArray(rawSlides)) return [];
  return rawSlides.filter(isRecord) as DeckSlide[];
}

function slideStageStyle(
  theme: DeckTheme,
  palette: ResolvedSlidePalette,
): CSSProperties {
  const style: Record<string, string> = {
    backgroundColor: palette.background,
    color: palette.text,
    "--slide-bg": palette.background,
    "--slide-fg": palette.text,
    "--slide-heading": palette.heading,
    "--slide-subtitle": palette.subtitle,
    "--slide-accent": palette.accentBar,
    "--slide-column-bg": palette.columnBg,
    "--slide-column-border": palette.columnBorder,
  };
  if (theme.fonts?.body !== undefined) {
    style["fontFamily"] = theme.fonts.body;
  }
  return style as CSSProperties;
}

function renderRichRun(run: unknown, key: number): ReactNode {
  if (typeof run === "string") return run;
  if (!isRecord(run) || typeof run["text"] !== "string") return null;
  let node: ReactNode = run["text"];
  if (run["bold"] === true || Number(run["weight"]) >= 600) {
    node = <strong key={`b-${String(key)}`}>{node}</strong>;
  }
  if (run["italic"] === true) {
    node = <em key={`i-${String(key)}`}>{node}</em>;
  }
  if (run["underline"] === true) {
    node = <u key={`u-${String(key)}`}>{node}</u>;
  }
  if (run["strike"] === true) {
    node = <s key={`s-${String(key)}`}>{node}</s>;
  }
  return <span key={key}>{node}</span>;
}

function renderRichText(value: unknown): ReactNode {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((run, index) => renderRichRun(run, index));
  }
  return null;
}

function renderNestedList(nestedItems: unknown[], ordered: boolean): ReactNode {
  if (nestedItems.length === 0) return null;
  if (ordered) {
    return <ol>{renderListItems(nestedItems)}</ol>;
  }
  return <ul>{renderListItems(nestedItems)}</ul>;
}

function renderListItems(items: unknown[]) {
  return items.map((item, index) => {
    if (isRecord(item) && "text" in item) {
      const nestedOrdered = item["ordered"] === true;
      return (
        <li key={index}>
          {renderRichText(item["text"])}
          {Array.isArray(item["items"])
            ? renderNestedList(item["items"], nestedOrdered)
            : null}
        </li>
      );
    }
    return <li key={index}>{renderRichText(item)}</li>;
  });
}

function SlideBodyBlockView({ block }: { block: SlideBodyBlock }) {
  if (typeof block === "string") return <p>{block}</p>;
  const blockType = block.type ?? block.kind;
  if (blockType === "paragraph") {
    const rendered = renderRichText(block.text);
    return rendered === null ? null : <p>{rendered}</p>;
  }
  if (blockType === "list" && Array.isArray(block.items)) {
    if (block.ordered === true) {
      return <ol>{renderListItems(block.items)}</ol>;
    }
    return <ul>{renderListItems(block.items)}</ul>;
  }
  const fallback = renderRichText(block.text);
  return fallback === null ? null : <p>{fallback}</p>;
}

function SlideBodyContent({ body }: { body: unknown }) {
  if (typeof body === "string") {
    return (
      <div className="approval-package-slide-body">
        <p>{body}</p>
      </div>
    );
  }
  if (!Array.isArray(body) || body.length === 0) return null;
  return (
    <div className="approval-package-slide-body">
      {body.map((block, index) => (
        <SlideBodyBlockView key={index} block={block as SlideBodyBlock} />
      ))}
    </div>
  );
}

function SlideColumns({
  slide,
  headingColor,
}: {
  slide: DeckSlide;
  headingColor: string;
}) {
  if (slide.layout === "two-column") {
    return (
      <div className="approval-package-columns">
        <div className="approval-package-column">
          <SlideBodyContent body={slide.left} />
        </div>
        <div className="approval-package-column">
          <SlideBodyContent body={slide.right} />
        </div>
      </div>
    );
  }
  if (slide.layout === "comparison") {
    const leftSide = isRecord(slide.left) ? slide.left : undefined;
    const rightSide = isRecord(slide.right) ? slide.right : undefined;
    const leftHeading =
      typeof leftSide?.["heading"] === "string"
        ? leftSide["heading"]
        : undefined;
    const rightHeading =
      typeof rightSide?.["heading"] === "string"
        ? rightSide["heading"]
        : undefined;
    return (
      <div className="approval-package-columns">
        <div className="approval-package-column">
          {leftHeading === undefined ? null : (
            <h4
              className="approval-package-column-heading"
              style={{ color: headingColor }}
            >
              {leftHeading}
            </h4>
          )}
          <SlideBodyContent body={leftSide?.["body"]} />
        </div>
        <div className="approval-package-column">
          {rightHeading === undefined ? null : (
            <h4
              className="approval-package-column-heading"
              style={{ color: headingColor }}
            >
              {rightHeading}
            </h4>
          )}
          <SlideBodyContent body={rightSide?.["body"]} />
        </div>
      </div>
    );
  }
  return null;
}

function collectFreeParagraphs(elements: unknown[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (const [elIdx, el] of elements.entries()) {
    if (!isRecord(el)) continue;
    if (el["type"] === "group" && Array.isArray(el["children"])) {
      out.push(...collectFreeParagraphs(el["children"]));
      continue;
    }
    if (el["type"] === "text" && Array.isArray(el["paragraphs"])) {
      for (const [pIdx, para] of el["paragraphs"].entries()) {
        if (!isRecord(para) || !Array.isArray(para["runs"])) continue;
        out.push(
          <p key={`${String(elIdx)}-${String(pIdx)}`}>
            {renderRichText(para["runs"])}
          </p>,
        );
      }
    }
  }
  return out;
}

function SlideCanvas({
  slide,
  index,
  total,
  theme,
  pageFooter,
}: {
  slide: DeckSlide;
  index: number;
  total: number;
  theme: DeckTheme;
  pageFooter?: string;
}) {
  const palette = resolveSlidePalette(theme);
  const layout = slide.layout ?? "content";
  const titleStyle: CSSProperties = { color: palette.heading };
  if (theme.fonts?.heading !== undefined) {
    titleStyle.fontFamily = theme.fonts.heading;
  }
  const freeParagraphs =
    layout === "free" && Array.isArray(slide.elements)
      ? collectFreeParagraphs(slide.elements)
      : [];
  return (
    <div
      className="approval-package-slide-stage"
      style={slideStageStyle(theme, palette)}
      data-slide-layout={layout}
      data-slide-tone={palette.isDark ? "dark" : "light"}
    >
      <div
        className="approval-package-slide-accent-bar"
        style={{ backgroundColor: palette.accentBar }}
        aria-hidden="true"
      />
      <div className="approval-package-slide-canvas">
        {typeof slide.title === "string" ||
        typeof slide.subtitle === "string" ? (
          <header className="approval-package-slide-heading">
            {layout === "title" ? (
              <span
                className="approval-package-slide-kicker"
                style={{ backgroundColor: palette.accentBar }}
                aria-hidden="true"
              />
            ) : null}
            {typeof slide.title === "string" ? (
              <h3 className="approval-package-slide-title" style={titleStyle}>
                {slide.title}
              </h3>
            ) : null}
            {typeof slide.subtitle === "string" ? (
              <p
                className="approval-package-slide-subtitle"
                style={{ color: palette.subtitle }}
              >
                {slide.subtitle}
              </p>
            ) : null}
          </header>
        ) : null}
        <SlideBodyContent body={slide.body} />
        {freeParagraphs.length === 0 ? null : (
          <div className="approval-package-slide-body">{freeParagraphs}</div>
        )}
        <SlideColumns slide={slide} headingColor={palette.columnHeading} />
        {typeof slide.caption === "string" ? (
          <p
            className="approval-package-slide-caption"
            style={{ color: palette.subtitle }}
          >
            {slide.caption}
          </p>
        ) : null}
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
  slide: DeckSlide;
  index: number;
  total: number;
  theme: DeckTheme;
}) {
  return (
    <article
      className="approval-package-slide"
      data-slide-layout={slide.layout ?? "content"}
    >
      <div className="approval-package-slide-meta">
        <span className="approval-package-slide-index">
          {text.slideCount(index + 1, total)}
        </span>
        {typeof slide.layout === "string" ? (
          <Badge tone="neutral">{slide.layout}</Badge>
        ) : null}
      </div>
      <SlideCanvas slide={slide} index={index} total={total} theme={theme} />
    </article>
  );
}

export function SlidesView({ deck }: { deck: Record<string, unknown> }) {
  const theme = readDeckTheme(deck);
  const slides = readDeckSlides(deck);
  if (slides.length === 0) {
    return <p className="inline-note">{text.noSlides}</p>;
  }
  return (
    <div className="approval-package-slides">
      {slides.map((slide, index) => (
        <SlideCard
          key={index}
          slide={slide}
          index={index}
          total={slides.length}
          theme={theme}
        />
      ))}
    </div>
  );
}

// Chromium and Brave block data:application/pdf URLs inside <iframe>;
// rendering 16:9 print sheets with a blob-backed download avoids browser blocking.
function PdfView({
  bundle,
  stem,
}: {
  bundle: ApprovalPackageBundle;
  stem: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      return;
    }
    const file = approvalPackagePdfFile(stem, bundle);
    const objectUrl = URL.createObjectURL(file);
    setBlobUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [stem, bundle]);

  const dataUrlMatch = /^data:[^;,]*;base64,(.*)$/s.exec(bundle.pdfBase64);
  const fallbackHref =
    dataUrlMatch === null
      ? `data:application/pdf;base64,${bundle.pdfBase64}`
      : bundle.pdfBase64;
  const pdfHref = blobUrl ?? fallbackHref;

  const theme = readDeckTheme(bundle.deck);
  const slides = readDeckSlides(bundle.deck);

  return (
    <div className="approval-package-pdf" aria-label={text.pdfTitle}>
      <div className="approval-package-pdf-toolbar">
        <div className="approval-package-pdf-toolbar-meta">
          <strong className="approval-package-pdf-title">
            {text.pdfTitle}
          </strong>
          <span className="approval-package-pdf-filename">{stem}.pdf</span>
        </div>
        <div className="approval-package-pdf-toolbar-actions">
          {blobUrl === null ? null : (
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
      </div>
      {slides.length === 0 ? (
        <p className="inline-note">{text.noSlides}</p>
      ) : (
        <div className="approval-package-pdf-pages">
          {slides.map((slide, index) => (
            <div key={index} className="approval-package-pdf-page">
              <SlideCanvas
                slide={slide}
                index={index}
                total={slides.length}
                theme={theme}
                pageFooter={text.pageCount(index + 1, slides.length)}
              />
            </div>
          ))}
        </div>
      )}
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
  if (bundle === null) {
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
      {activeTab === "slides" ? <SlidesView deck={bundle.deck} /> : null}
      {activeTab === "pdf" ? <PdfView bundle={bundle} stem={stem} /> : null}
      {activeTab === "sources" ? (
        <SourcesView bundle={bundle} onOpenSource={onOpenSource} />
      ) : null}
    </section>
  );
}
