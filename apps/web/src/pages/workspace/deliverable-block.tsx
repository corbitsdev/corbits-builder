/**
 * One thing an agent wrote, in the reading pane. Prose is markdown. A design
 * is the sandboxed page inside a device frame, not a dump of its source.
 * Changes are retained versions: inline tracked changes for prose, line diff
 * for HTML and JSON.
 */
import { wording } from "../../config.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CsvTable, ShimmerText } from "@corbits/react-ui";
import { Markdown } from "../../markdown.jsx";
import { APPROVAL_PACKAGE_MEDIA_TYPE } from "./approval-package.ts";
import { ApprovalPackagePreview } from "./approval-package-preview.tsx";
import { DESIGN_MEDIA_TYPE, parseBundle } from "./design-bundle.ts";
import { DesignPreviewView, type DesignPart } from "./design-preview.view.tsx";
import { ComparisonView } from "./comparison-view.tsx";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import { predecessorOf, type RetainedVersion } from "./document-versions.ts";
import { PassageQuotes, type PassageQuote } from "./passage-note.tsx";
import { versionGroup } from "./version-menu.tsx";
import { PaneBar } from "./pane-bar.tsx";
import {
  csvFile,
  fileStem,
  markdownFile,
  type PaneFile,
  useFileGroup,
  ZIP_TYPE,
  zipFile,
} from "./pane-file.tsx";
import { splitLeadingHeading } from "./reading-selection.ts";
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import { ApproachesComparison } from "./approaches-comparison.tsx";
import type { ApproachChoice } from "./approach-choice.ts";
import type { TweakPanelProps } from "./mockup-tweaks.view.tsx";
import { Fault, InlineNote } from "../../components.jsx";
import styles from "./deliverable-block.module.css";

export type { RetainedVersion };

/** One version's text, when it was filed and, on an approaches document that filed them, its approaches. */
export type ReadVersion = {
  content: string;
  filedAt: string;
  approaches?: ApproachesMeta;
};

export type LoadedDeliverable = ReadVersion & {
  title: string;
  mediaType: string;
  version: number;
  sha256: string;
  before: (ReadVersion & { version: number }) | null;
  historyError?: string;
  versions: readonly RetainedVersion[];
};

export type DeliverableState =
  | { status: "loading" }
  | { status: "error"; message: string; retryable: boolean }
  | { status: "ready"; document: LoadedDeliverable };

function mediaKind(
  mediaType: string,
  title: string,
):
  | "html"
  | "design"
  | "approval_package"
  | "json"
  | "prose"
  | "sheet"
  | "text"
  | "image"
  | "file" {
  if (mediaType === "text/html") return "html";
  if (mediaType === DESIGN_MEDIA_TYPE) return "design";
  if (mediaType === APPROVAL_PACKAGE_MEDIA_TYPE) return "approval_package";
  if (mediaType === "application/json") return "json";
  if (mediaType === "text/markdown") return "prose";
  // A material is titled with its file name; a CSV that is not UTF-8 is a data: URL, so it stays a file.
  if (mediaType === "text/plain")
    return title.toLowerCase().endsWith(".csv") ? "sheet" : "text";
  return mediaType.startsWith("image/") ? "image" : "file";
}

/** A spreadsheet fills its pane edge to edge, as a mockup does. */
export const fillsPane = (state: DeliverableState | undefined) =>
  state?.status === "ready" &&
  mediaKind(state.document.mediaType, state.document.title) === "sheet";

/** What an approval package's tab hands the approval rounds drawn in it. */
export type PackageRounds = {
  /** The package version being read. */
  packageVersion: number;
  packageContent: string;
  packageVersions: readonly number[];
  onReadPackageVersion: (version: number) => Promise<string>;
  /** The bar's Add new reviewer is on. */
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
  onAddToPrompt?: ((passage: PassageQuote) => void) | undefined;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
};

/** The parts of a document that read the hub for themselves, which whoever draws it fills. */
export type DeliverableSlots = {
  /** An approval package's rounds: who was asked to sign off and what each decided. */
  approvalRounds: (rounds: PackageRounds) => ReactNode;
  /** The look panel a design mockup's bar opens over it. */
  tweakPanel: (panel: TweakPanelProps) => ReactNode;
};

export function DeliverableBody({
  state,
  designPart = "mockup",
  fileName,
  changesOpen,
  onToggleChanges,
  onRetry,
  onReadVersion,
  onAddToPrompt,
  onDeliverMessage,
  onViewVersion,
  approachChoice,
  requestedVersion,
  onOpenSource,
  approvalRounds,
  tweakPanel,
}: DeliverableSlots & {
  state: DeliverableState | undefined;
  designPart?: DesignPart;
  /** The project and the tab's name, which name the file the pane downloads and shares. */
  fileName: { project: string; document: string };
  changesOpen: boolean;
  onToggleChanges: () => void;
  onRetry?: (() => void) | undefined;
  onReadVersion?: (version: number) => Promise<ReadVersion>;
  onAddToPrompt?: (passage: PassageQuote) => void;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  /** The person chose a version to read, which holds this document in the pane. */
  onViewVersion?: () => void;
  /** The person's pick of a filed approach, and how to make it. */
  approachChoice?: ApproachChoice;
  /** A specific version requested when jumping from a pinned source document. */
  requestedVersion?: { version: number; seq: number } | undefined;
  /** Opens a pinned source document tab at its pinned version. */
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
}) {
  if (state === undefined) return <InlineNote>Nothing to read yet.</InlineNote>;
  if (state.status === "loading") {
    return (
      <div
        className={styles.loading}
        data-slot="document-loading"
        role="status"
      >
        <ShimmerText>Reading the document…</ShimmerText>
      </div>
    );
  }
  if (state.status === "error")
    return <Fault onRetry={onRetry}>{state.message}</Fault>;
  return (
    <ReadyDocument
      key={`${state.document.sha256}:${String(state.document.version)}:${state.document.content}`}
      document={state.document}
      designPart={designPart}
      fileName={fileName}
      changesOpen={changesOpen}
      onToggleChanges={onToggleChanges}
      {...(onReadVersion === undefined ? {} : { onReadVersion })}
      {...(onAddToPrompt === undefined ? {} : { onAddToPrompt })}
      {...(onDeliverMessage === undefined ? {} : { onDeliverMessage })}
      {...(onViewVersion === undefined ? {} : { onViewVersion })}
      {...(approachChoice === undefined ? {} : { approachChoice })}
      {...(requestedVersion === undefined ? {} : { requestedVersion })}
      {...(onOpenSource === undefined ? {} : { onOpenSource })}
      approvalRounds={approvalRounds}
      tweakPanel={tweakPanel}
    />
  );
}

const shownFile = (file: File, download: string, share: string): PaneFile => ({
  type: file.type,
  download,
  share,
  key: file.name,
  prepare: "shown",
  build: () => Promise.resolve({ file }),
});

const documentFile = (file: File) =>
  shownFile(
    file,
    wording.paneFile.downloadDocument,
    wording.paneFile.shareDocument,
  );

function ReadyDocument({
  document,
  designPart,
  fileName,
  changesOpen,
  onToggleChanges,
  onReadVersion,
  onAddToPrompt,
  onDeliverMessage,
  onViewVersion,
  approachChoice,
  requestedVersion,
  onOpenSource,
  approvalRounds,
  tweakPanel,
}: DeliverableSlots & {
  document: LoadedDeliverable;
  designPart: DesignPart;
  fileName: { project: string; document: string };
  changesOpen: boolean;
  onToggleChanges: () => void;
  onReadVersion?: (version: number) => Promise<ReadVersion>;
  onAddToPrompt?: (passage: PassageQuote) => void;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  onViewVersion?: () => void;
  approachChoice?: ApproachChoice;
  requestedVersion?: { version: number; seq: number } | undefined;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
}) {
  const [viewing, setViewing] = useState(document.version);
  const [cache, setCache] = useState<Record<number, ReadVersion>>({});
  const [baseline, setBaseline] = useState<number | null>(null);
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [shareOpen, setShareOpen] = useState(false);
  const readRef = useRef(onReadVersion);
  readRef.current = onReadVersion;

  const readFor = (version: number): ReadVersion | null => {
    if (cache[version] !== undefined) return cache[version] ?? null;
    if (version === document.version) return document;
    if (document.before?.version === version) return document.before;
    return null;
  };
  const textFor = (version: number): string | null =>
    readFor(version)?.content ?? null;

  const predecessor = predecessorOf(
    document.versions,
    viewing,
    document.version,
    document.before?.version ?? null,
  );
  const compareWith = changesOpen ? (baseline ?? predecessor) : null;
  const afterText = textFor(viewing);
  const beforeText = compareWith === null ? null : textFor(compareWith);
  const viewed = document.versions.find((item) => item.version === viewing);
  const mediaType = viewed?.mediaType ?? document.mediaType;
  const title = viewed?.title ?? document.title;
  const kind = mediaKind(mediaType, title);
  const shown = readFor(viewing);
  const approaches = shown?.approaches;
  const chooseApproach =
    viewing === document.version ? approachChoice?.choose : undefined;

  const remember = (version: number, read: ReadVersion) => {
    setCache((current) => ({ ...current, [version]: read }));
  };

  const fetchVersion = async (version: number): Promise<string> => {
    const known = textFor(version);
    if (known !== null) return known;
    const read = readRef.current;
    if (read === undefined)
      throw new Error("This version is listed, but the room cannot read it.");
    const loaded = await read(version);
    remember(version, loaded);
    return loaded.content;
  };

  // Reads a version the room has not loaded, then acts on it; a failed read is the block's error line.
  const withVersion = async (version: number, use: () => void) => {
    setPendingVersion(version);
    setReadError(null);
    try {
      await fetchVersion(version);
      use();
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingVersion(null);
    }
  };

  const selectVersion = (version: number) => {
    if (version === viewing) return;
    onViewVersion?.();
    setReadError(null);
    if (textFor(version) !== null) {
      setViewing(version);
      return;
    }
    void withVersion(version, () => setViewing(version));
  };

  const appliedRequestSeq = useRef<number | null>(null);
  useEffect(() => {
    if (
      requestedVersion !== undefined &&
      requestedVersion.seq !== appliedRequestSeq.current
    ) {
      appliedRequestSeq.current = requestedVersion.seq;
      selectVersion(requestedVersion.version);
    }
  }, [requestedVersion]);

  const comparePrevious = () => {
    if (predecessor === null) return;
    void withVersion(predecessor, () => {
      setBaseline(predecessor);
      if (!changesOpen) onToggleChanges();
    });
  };

  const stopComparing = () => {
    setBaseline(null);
    if (changesOpen) onToggleChanges();
  };

  const lifted =
    kind === "prose"
      ? splitLeadingHeading(afterText ?? "")
      : { heading: null, body: afterText ?? "" };
  const body = lifted.body;
  const comparing =
    changesOpen &&
    compareWith !== null &&
    beforeText !== null &&
    afterText !== null;
  const comparison =
    comparing && compareWith !== null ? (
      <ComparisonView
        before={beforeText}
        after={afterText}
        beforeVersion={compareWith}
        afterVersion={viewing}
        prose={kind === "prose"}
        onClose={stopComparing}
      />
    ) : null;
  const stem = fileStem(
    fileName.project,
    kind === "sheet"
      ? fileName.document.replace(/\.csv$/i, "")
      : fileName.document,
    `v${String(viewing)}`,
  );
  const design =
    kind === "design" && afterText !== null ? parseBundle(afterText) : null;
  const plan = designPart === "plan" ? design?.["DESIGN.md"] : undefined;
  const sourceFile = (): PaneFile | null => {
    if (kind === "prose" && afterText !== null)
      return documentFile(markdownFile(stem, afterText));
    if (plan !== undefined) return documentFile(markdownFile(stem, plan));
    if (design !== null && designPart === "mockup")
      return {
        type: ZIP_TYPE,
        download: wording.paneFile.downloadDesign,
        share: wording.paneFile.shareDesign,
        key: `${stem}.zip`,
        prepare: "shown",
        build: async () => ({ file: await zipFile(stem, design) }),
      };
    if (kind === "approval_package") {
      return null;
    }
    if (kind === "sheet" && afterText !== null)
      return shownFile(
        csvFile(stem, afterText),
        wording.paneFile.downloadSheet,
        wording.paneFile.shareSheet,
      );
    return null;
  };
  const files = useFileGroup(sourceFile());
  const approvalGroup =
    kind === "approval_package"
      ? [
          {
            id: "add-reviewers",
            label: wording.approvalRound.shareButton,
            text: wording.approvalRound.shareButton,
            active: shareOpen,
            onSelect: () => setShareOpen((current) => !current),
          },
        ]
      : [];
  const barGroups = [
    approvalGroup,
    versionGroup({
      versions: document.versions,
      viewing,
      pending: pendingVersion !== null,
      canCompare:
        predecessor !== null &&
        !comparing &&
        kind !== "approval_package" &&
        kind !== "image" &&
        kind !== "file",
      onView: selectVersion,
      onComparePrevious: comparePrevious,
    }),
    files,
  ];
  // A mockup or spreadsheet fills the pane edge to edge: its tab names it, and its notes float over the page.
  const fill =
    (kind === "design" && designPart === "mockup") || kind === "sheet";
  const visual =
    kind === "html" || (kind === "design" && designPart === "mockup");
  const readingView = () => {
    if (kind === "html")
      return (
        <DevicePreview
          html={body}
          device={device}
          onDevice={setDevice}
          trailing={barGroups}
        />
      );
    if (kind === "design")
      return (
        <DesignPreviewView
          files={parseBundle(body)}
          part={designPart}
          device={device}
          onDevice={setDevice}
          trailing={barGroups}
          fill={fill}
          tweakPanel={tweakPanel}
        />
      );
    if (kind === "approval_package")
      return (
        <ApprovalPackagePreview
          content={body}
          stem={stem}
          {...(onOpenSource === undefined ? {} : { onOpenSource })}
        />
      );
    if (kind === "sheet")
      return <CsvTable text={body} caption={title} interactive />;
    if (kind === "json" || kind === "text")
      return <pre className={styles.raw}>{body}</pre>;
    if (kind === "image")
      return <img className={styles.image} src={body} alt={title} />;
    if (kind === "file")
      return (
        <p>
          <a href={body} download={title}>
            {wording.attach.open(title)}
          </a>
        </p>
      );
    if (comparing) return null;
    return (
      <>
        {approaches === undefined ? null : (
          <ApproachesComparison
            meta={approaches}
            chosen={
              shown === null
                ? undefined
                : approachChoice?.chosen(approaches, shown.filedAt)
            }
            {...(chooseApproach === undefined
              ? {}
              : {
                  onChoose: (message: string) =>
                    chooseApproach(message, viewing),
                })}
          />
        )}
        <Markdown source={body} document />
      </>
    );
  };
  const add = onAddToPrompt === undefined ? {} : { onAdd: onAddToPrompt };

  const notes = (
    <>
      {viewing !== document.version ? (
        <InlineNote role="status" pill={fill}>
          Showing v{String(viewing)}. The plan names v{String(document.version)}
          .
        </InlineNote>
      ) : null}
      {pendingVersion !== null ? (
        <InlineNote role="status" pill={fill}>
          Reading v{String(pendingVersion)}…
        </InlineNote>
      ) : null}
      {readError !== null ? <Fault>{readError}</Fault> : null}
      {document.historyError !== undefined ? (
        <InlineNote role="status" pill={fill}>
          History unavailable: {document.historyError}
        </InlineNote>
      ) : null}
      {changesOpen && compareWith !== null && beforeText === null ? (
        <InlineNote role="status" pill={fill}>
          Reading v{String(compareWith)} for comparison…
        </InlineNote>
      ) : null}
    </>
  );

  const renderDocumentHeader = () => {
    if (fill) {
      return <div className={styles.notes}>{notes}</div>;
    }
    if (kind === "approval_package") {
      return notes;
    }
    return (
      <>
        <header className={styles.header} data-slot="document-header">
          <h1 className={styles.title} title={title}>
            {lifted.heading ?? title}
          </h1>
        </header>
        {notes}
      </>
    );
  };

  return (
    <div className={styles.body} data-slot="deliverable-body">
      {renderDocumentHeader()}
      {kind === "approval_package" ? (
        <PassageQuotes title={title} version={viewing} {...add}>
          {approvalRounds({
            packageVersion: viewing,
            packageContent: body,
            packageVersions: document.versions.map((item) => item.version),
            onReadPackageVersion: fetchVersion,
            shareOpen,
            onShareOpenChange: setShareOpen,
            onOpenSource,
            onAddToPrompt,
            onDeliverMessage,
          })}
        </PassageQuotes>
      ) : (
        <PassageQuotes title={title} version={viewing} fill={fill} {...add}>
          {readingView()}
          {comparison}
        </PassageQuotes>
      )}
      {visual ? null : (
        <PaneBar label={wording.documentBar} groups={barGroups} floating />
      )}
    </div>
  );
}
