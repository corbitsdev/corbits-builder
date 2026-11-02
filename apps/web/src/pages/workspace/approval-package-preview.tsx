import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@corbits/react-ui";
import {
  ApprovalPackageBundle,
  type ApprovalPackageSource,
} from "@corbits-builder/schemas/artifact";
import { type } from "arktype";
import { useState, type CSSProperties } from "react";
import { wording } from "../../config.ts";

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
  colors?: DeckThemeColors;
  fonts?: {
    heading?: string;
    body?: string;
  };
}

type SlideBodyBlock =
  | string
  | {
      kind?: string;
      text?: string;
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
  src?: string;
  caption?: string;
  notes?: string;
  speakerNotes?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const binary = atob(bundle.pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], `${stem}.pdf`, { type: "application/pdf" });
}

function readDeckTheme(deck: Record<string, unknown>): DeckTheme {
  const rawTheme = deck["theme"];
  if (!isRecord(rawTheme)) return {};
  const colors = isRecord(rawTheme["colors"])
    ? (rawTheme["colors"] as DeckThemeColors)
    : undefined;
  const fonts = isRecord(rawTheme["fonts"])
    ? (rawTheme["fonts"] as DeckTheme["fonts"])
    : undefined;
  return {
    ...(colors === undefined ? {} : { colors }),
    ...(fonts === undefined ? {} : { fonts }),
  };
}

function readDeckSlides(deck: Record<string, unknown>): DeckSlide[] {
  const rawSlides = deck["slides"];
  if (!Array.isArray(rawSlides)) return [];
  return rawSlides.filter(isRecord) as DeckSlide[];
}

function slideCardStyle(theme: DeckTheme): CSSProperties {
  const colors = theme.colors;
  const fonts = theme.fonts;
  return {
    ...(colors?.background === undefined
      ? {}
      : { backgroundColor: colors.background }),
    ...(colors?.text === undefined ? {} : { color: colors.text }),
    ...(colors?.primary === undefined ? {} : { borderColor: colors.primary }),
    ...(fonts?.body === undefined ? {} : { fontFamily: fonts.body }),
  };
}

function renderListItems(items: unknown[]) {
  return items.map((item, index) => (
    <li key={index}>
      {typeof item === "string" ? item : JSON.stringify(item)}
    </li>
  ));
}

function SlideBodyBlockView({ block }: { block: SlideBodyBlock }) {
  if (typeof block === "string") return <p>{block}</p>;
  if (block.kind === "paragraph" && typeof block.text === "string")
    return <p>{block.text}</p>;
  if (block.kind === "list" && Array.isArray(block.items)) {
    if (block.ordered === true) {
      return <ol>{renderListItems(block.items)}</ol>;
    }
    return <ul>{renderListItems(block.items)}</ul>;
  }
  if (typeof block.text === "string") return <p>{block.text}</p>;
  return null;
}

function SlideBodyContent({ body }: { body: unknown }) {
  if (typeof body === "string") return <p>{body}</p>;
  if (!Array.isArray(body)) return null;
  return (
    <div className="approval-package-slide-body">
      {body.map((block, index) => (
        <SlideBodyBlockView key={index} block={block as SlideBodyBlock} />
      ))}
    </div>
  );
}

function SlideColumns({ slide }: { slide: DeckSlide }) {
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
          {leftHeading === undefined ? null : <h4>{leftHeading}</h4>}
          <SlideBodyContent body={leftSide?.["body"]} />
        </div>
        <div className="approval-package-column">
          {rightHeading === undefined ? null : <h4>{rightHeading}</h4>}
          <SlideBodyContent body={rightSide?.["body"]} />
        </div>
      </div>
    );
  }
  return null;
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
  const notes = slide.notes ?? slide.speakerNotes;
  const headingColor = theme.colors?.primary;
  const subtitleColor = theme.colors?.secondary ?? theme.colors?.muted;
  return (
    <Card
      className="approval-package-slide"
      style={slideCardStyle(theme)}
      data-slide-layout={slide.layout ?? "content"}
    >
      <CardHeader>
        <div className="approval-package-slide-meta">
          <Badge tone="neutral">{text.slideCount(index + 1, total)}</Badge>
          {typeof slide.layout === "string" ? (
            <Badge tone="accent">{slide.layout}</Badge>
          ) : null}
        </div>
        {typeof slide.title === "string" ? (
          <CardTitle
            style={
              headingColor === undefined ? undefined : { color: headingColor }
            }
          >
            {slide.title}
          </CardTitle>
        ) : null}
        {typeof slide.subtitle === "string" ? (
          <CardDescription
            style={
              subtitleColor === undefined ? undefined : { color: subtitleColor }
            }
          >
            {slide.subtitle}
          </CardDescription>
        ) : null}
      </CardHeader>
      <SlideBodyContent body={slide.body} />
      <SlideColumns slide={slide} />
      {typeof slide.caption === "string" ? (
        <p className="approval-package-slide-caption">{slide.caption}</p>
      ) : null}
      {typeof notes === "string" && notes.length > 0 ? (
        <footer className="approval-package-slide-notes">
          <strong>{text.speakerNotes}:</strong> {notes}
        </footer>
      ) : null}
    </Card>
  );
}

function SlidesView({ deck }: { deck: Record<string, unknown> }) {
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

function PdfView({
  bundle,
  stem,
}: {
  bundle: ApprovalPackageBundle;
  stem: string;
}) {
  const pdfHref = `data:application/pdf;base64,${bundle.pdfBase64}`;
  const pptxHref = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${bundle.pptxBase64}`;
  return (
    <div className="approval-package-pdf">
      <div className="approval-package-downloads">
        <a
          className="approval-package-download-link"
          href={pdfHref}
          download={`${stem}.pdf`}
        >
          {text.downloadPdf}
        </a>
        <a
          className="approval-package-download-link"
          href={pptxHref}
          download={`${stem}.pptx`}
        >
          {text.downloadPptx}
        </a>
      </div>
      <iframe
        className="approval-package-pdf-frame"
        title={text.pdfTitle}
        src={pdfHref}
      />
    </div>
  );
}

function SourceRow({ source }: { source: ApprovalPackageSource }) {
  const kindLabel = wording.documentTab[source.kind] ?? source.kind;
  return (
    <tr>
      <td>{kindLabel}</td>
      <td>{source.title}</td>
      <td>v{String(source.version)}</td>
      <td>
        <code>{source.sha256.slice(0, 12)}</code>
      </td>
    </tr>
  );
}

function SourcesView({ bundle }: { bundle: ApprovalPackageBundle }) {
  const { manifest, documents } = bundle;
  const docEntries = documents === undefined ? [] : Object.entries(documents);
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
              />
            ))}
          </tbody>
        </table>
      </section>
      {docEntries.length === 0 ? null : (
        <section aria-label={text.manifest.documents}>
          <h3>{text.manifest.documents}</h3>
          <ul className="approval-package-documents-list">
            {docEntries.map(([name]) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ApprovalPackagePreview({
  content,
  stem,
  initialTab = "slides",
}: {
  content: string;
  stem: string;
  initialTab?: ApprovalPackageViewTab;
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
          variant={activeTab === "slides" ? "primary" : "outline"}
          aria-selected={activeTab === "slides"}
          onClick={() => setActiveTab("slides")}
        >
          {text.tabs.slides}
        </Button>
        <Button
          role="tab"
          size="sm"
          variant={activeTab === "pdf" ? "primary" : "outline"}
          aria-selected={activeTab === "pdf"}
          onClick={() => setActiveTab("pdf")}
        >
          {text.tabs.pdf}
        </Button>
        <Button
          role="tab"
          size="sm"
          variant={activeTab === "sources" ? "primary" : "outline"}
          aria-selected={activeTab === "sources"}
          onClick={() => setActiveTab("sources")}
        >
          {text.tabs.sources}
        </Button>
      </div>
      {activeTab === "slides" ? <SlidesView deck={bundle.deck} /> : null}
      {activeTab === "pdf" ? <PdfView bundle={bundle} stem={stem} /> : null}
      {activeTab === "sources" ? <SourcesView bundle={bundle} /> : null}
    </section>
  );
}
