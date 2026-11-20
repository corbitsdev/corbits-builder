/**
 * One thing an agent wrote, in the reading pane. Prose is markdown. A design
 * is the sandboxed page inside a device frame, not a dump of its source.
 * Changes are retained versions: inline tracked changes for prose, line diff
 * for HTML and JSON.
 */
import { wording } from "../../config.ts";
import { Fragment, useState, type ReactNode } from "react";
import { CsvTable, ShimmerText } from "@corbits/react-ui";
import { APPROVAL_PACKAGE_MEDIA_TYPE } from "./approval-package.ts";
import { ApprovalPackagePreview } from "./approval-package-preview.tsx";
import { DESIGN_MEDIA_TYPE, parseBundle } from "./design-bundle.ts";
import { DesignPreviewView, type DesignPart } from "./design-preview.view.tsx";
import { ComparisonView } from "./comparison-view.tsx";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import type { RetainedVersion } from "./document-versions.ts";
import { PassageQuotes } from "./passage-note.tsx";
import type { PassageQuote } from "./passage-quote.ts";
import { versionGroup } from "./version-menu.tsx";
import { useVersionReading } from "./version-reading.ts";
import { useApproveGroup } from "./approve-group.ts";
import { VersionNotes } from "./version-notes.tsx";
import { PaneBar } from "./pane-bar.tsx";
import {
  csvFile,
  documentFile,
  fileStem,
  markdownFile,
  type PaneFile,
  shownFile,
  useFileGroup,
  ZIP_TYPE,
  zipFile,
} from "./pane-file.tsx";
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import type { ApproachChoice } from "./approach-choice.ts";
import type { TweakPanelProps } from "./mockup-tweaks.view.tsx";
import type { DocumentPageProps } from "./document-page.model.ts";
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

/** A written document, read as a printed page rather than in the pane's own reading view. */
const readsAsPage = (document: LoadedDeliverable) =>
  mediaKind(document.mediaType, document.title) === "prose";

/** A spreadsheet or a written document's page fills its pane edge to edge, as a mockup does. */
export const fillsPane = (state: DeliverableState | undefined) =>
  state?.status === "ready" &&
  (readsAsPage(state.document) ||
    mediaKind(state.document.mediaType, state.document.title) === "sheet");

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

/**
 * The person's approval of the document they read, with no question asking for it: the version
 * approved and when, if any, and how to approve the version on show.
 */
export type DocumentApprovalControl = {
  approvedVersion: number | undefined;
  approvedAt: string | undefined;
  approve: (version: number) => Promise<void>;
};

/** The parts of a document that read the hub for themselves, which whoever draws it fills. */
export type DeliverableSlots = {
  /** An approval package's rounds: who was asked to sign off and what each decided. */
  approvalRounds: (rounds: PackageRounds) => ReactNode;
  /** The look panel a design mockup's bar opens over it. */
  tweakPanel: (panel: TweakPanelProps) => ReactNode;
  /** A written document's printed page, which reads the versions it is asked for. */
  writtenDocument: (page: DocumentPageProps) => ReactNode;
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
  approval,
  requestedVersion,
  onOpenSource,
  approvalRounds,
  tweakPanel,
  writtenDocument,
}: DeliverableSlots & {
  state: DeliverableState | undefined;
  /** Approving the document being read; absent where it cannot be approved here. */
  approval?: DocumentApprovalControl | undefined;
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
  const key = `${state.document.sha256}:${String(state.document.version)}:${state.document.content}`;
  if (readsAsPage(state.document))
    return (
      <Fragment key={key}>
        {writtenDocument({
          project: fileName.project,
          name: fileName.document,
          document: state.document,
          changesOpen,
          onToggleChanges,
          onReadVersion,
          onViewVersion,
          requestedVersion,
          approval,
          approachChoice,
          onAddToPrompt,
        })}
      </Fragment>
    );
  return (
    <ReadyDocument
      key={key}
      document={state.document}
      designPart={designPart}
      fileName={fileName}
      changesOpen={changesOpen}
      onToggleChanges={onToggleChanges}
      {...(onReadVersion === undefined ? {} : { onReadVersion })}
      {...(onAddToPrompt === undefined ? {} : { onAddToPrompt })}
      {...(onDeliverMessage === undefined ? {} : { onDeliverMessage })}
      {...(onViewVersion === undefined ? {} : { onViewVersion })}
      approval={approval}
      {...(requestedVersion === undefined ? {} : { requestedVersion })}
      {...(onOpenSource === undefined ? {} : { onOpenSource })}
      approvalRounds={approvalRounds}
      tweakPanel={tweakPanel}
    />
  );
}

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
  approval,
  requestedVersion,
  onOpenSource,
  approvalRounds,
  tweakPanel,
}: Omit<DeliverableSlots, "writtenDocument"> & {
  document: LoadedDeliverable;
  approval: DocumentApprovalControl | undefined;
  designPart: DesignPart;
  fileName: { project: string; document: string };
  changesOpen: boolean;
  onToggleChanges: () => void;
  onReadVersion?: (version: number) => Promise<ReadVersion>;
  onAddToPrompt?: (passage: PassageQuote) => void;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  onViewVersion?: () => void;
  requestedVersion?: { version: number; seq: number } | undefined;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
}) {
  const {
    viewing,
    afterText,
    beforeText,
    compareWith,
    predecessor,
    pendingVersion,
    readError,
    fetchVersion,
    selectVersion,
    comparePrevious,
    stopComparing,
  } = useVersionReading({
    document,
    changesOpen,
    onToggleChanges,
    onReadVersion,
    onViewVersion,
    requestedVersion,
  });
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [shareOpen, setShareOpen] = useState(false);
  const viewed = document.versions.find((item) => item.version === viewing);
  const mediaType = viewed?.mediaType ?? document.mediaType;
  const title = viewed?.title ?? document.title;
  const kind = mediaKind(mediaType, title);
  const body = afterText ?? "";
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
        prose={false}
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
  const approveGroup = useApproveGroup(approval, viewing, document.version);
  const barGroups = [
    approveGroup,
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
    return (
      <p>
        <a href={body} download={title}>
          {wording.attach.open(title)}
        </a>
      </p>
    );
  };
  const add = onAddToPrompt === undefined ? {} : { onAdd: onAddToPrompt };

  const notes = (
    <VersionNotes
      viewing={viewing}
      newest={document.version}
      reading={pendingVersion}
      readError={readError}
      historyError={document.historyError}
      readingForComparison={
        changesOpen && compareWith !== null && beforeText === null
          ? compareWith
          : null
      }
      pill={fill}
    />
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
            {title}
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
