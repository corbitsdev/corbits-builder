import { Button } from "@corbits/react-ui";
import {
  ApprovalPackageBundle,
  type ApprovalPackageSource,
} from "@corbits-builder/schemas/artifact";
import { type } from "arktype";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { wording } from "../../config.ts";
import { Markdown } from "../../markdown.jsx";

export const APPROVAL_PACKAGE_MEDIA_TYPE =
  "application/vnd.corbits-builder.approval-package+json";

const text = wording.approvalPackage;

export type ApprovalPackageViewTab = "slides" | "pdf" | "sources";

// The slide deck schema is costly to build, so it loads only once a package's slides are shown.
const DeckSlides = lazy(async () => ({
  default: (await import("./approval-package-slides.tsx")).DeckSlides,
}));
const DeckPages = lazy(async () => ({
  default: (await import("./approval-package-slides.tsx")).DeckPages,
}));

const loadingSlides = <p className="inline-note">{text.loadingSlides}</p>;

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

export function SlidesView({ deck }: { deck: Record<string, unknown> }) {
  return (
    <Suspense fallback={loadingSlides}>
      <DeckSlides deck={deck} />
    </Suspense>
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
      <Suspense fallback={loadingSlides}>
        <DeckPages deck={bundle.deck} />
      </Suspense>
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
  const bundle = useMemo(() => parseApprovalPackage(content), [content]);
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
