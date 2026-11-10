/**
 * The approval rounds as they look: each round a package went out in, its reviewers with what
 * they decided and what they asked for, the deck tailored to each and the files they download.
 * Everything shown arrives as props and everything the person does leaves as a callback, so any
 * state of the rounds can be drawn without a hub.
 */
import { Button } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import type { ReviewerOutcome } from "@corbits-builder/schemas/approval-round";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Maximize2,
  Presentation,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Fault, InlineNote, QuietState, type Tone } from "../../components.jsx";
import { wording } from "../../config.ts";
import {
  ApprovalField,
  ApprovalFields,
  FieldSaveButton,
  LeanButton,
  LeanInput,
  LeanSelect,
} from "../approval-fields.tsx";
import { SlidesView } from "./approval-package-preview.tsx";
import styles from "./approval-rounds.module.css";
import { SourceLink } from "./source-link.tsx";

const roundText = wording.approvalRound;
const OUTCOME_OPTIONS: readonly ReviewerOutcome[] = [
  "approve",
  "request_changes",
  "comment",
];

/** A slide deck as a package carries it. */
type Deck = Record<string, unknown>;

/** Something a reviewer asked for, and what the person did with it. */
export type Finding = {
  id: string;
  text: string;
  /** The slide it is about; null when it is about the package as a whole. */
  slide: number | null;
  status: "pending" | "incorporated" | "dismissed" | "replied";
  /** The hub is recording what the person did with it. */
  busy: boolean;
  fault: string | null;
  onIncorporate: () => void;
  onDismiss: () => void;
};

/** One file of a reviewer's package, as the download dialog lists it. */
export type PackageFile = {
  path: string;
  label: string;
  included: boolean;
  /** Opens the document the file is a copy of, from its name; null for the deck's own files. */
  onOpenSource: (() => void) | null;
};

export type Reviewer = {
  id: string;
  name: string;
  persona: string;
  /** What they are asked to decide on: their own goal, or the usual one for their persona. */
  goal: string;
  /** What they decided, or how far their package has got while they have not. */
  status: "sent" | "decided" | "expired" | ReviewerOutcome;
  /** Added a moment ago, so their drawer opens by itself. */
  justAdded: boolean;
  /** What the drawer's fields hold: what was typed, or what is saved. */
  fields: {
    name: string;
    persona: string;
    goal: string;
    outcome: ReviewerOutcome | "";
    note: string;
  };
  /** The fields that differ from what is saved; each offers to save itself. */
  unsaved: {
    name: boolean;
    persona: boolean;
    goal: boolean;
    outcome: boolean;
    note: boolean;
  };
  /** The person typed in the drawer. */
  onEdit: (fields: Partial<Reviewer["fields"]>) => void;
  /** The hub is saving their name, persona or goal. */
  savingDetails: boolean;
  onSaveDetails: () => void;
  /** The hub is saving their decision or its note. */
  savingDecision: boolean;
  onSaveOutcome: () => void;
  onSaveNote: () => void;
  fault: string | null;
  /** The deck tailored to them; null until there is one, when the drawer offers to generate it. */
  deck: Deck | null;
  /** The coordinator has been asked for their deck. */
  generatingDeck: boolean;
  onGenerateDeck: () => void;
  /** The dialog that picks which of their package's files to download. */
  download: {
    open: boolean;
    files: readonly PackageFile[];
    downloading: boolean;
    onOpen: () => void;
    onOpenChange: (open: boolean) => void;
    onToggleFile: (path: string) => void;
    onToggleAllFiles: () => void;
    onDownload: () => void;
  };
  /** What they asked for, once they have decided. */
  findings: readonly Finding[];
};

export type Round = {
  id: string;
  packageVersion: number;
  /** An open round's reviewers can still be edited; a settled one is closed for good. */
  status: "open" | "settled" | "expired";
  /** No reviewer is still to answer, so the round can be settled. */
  canSettle: boolean;
  settling: boolean;
  fault: string | null;
  onSettle: () => void;
  reviewers: readonly Reviewer[];
};

export type ApprovalRoundsViewProps = {
  /** Drawn in a document tab, which names the package itself: no heading, lead or round titles. */
  flush: boolean;
  /** The rounds are still being read. */
  loading: boolean;
  fault: string | null;
  /** The package's own deck, offered while it has no round; null when the package cannot be read. */
  packageDeck: Deck | null;
  rounds: readonly Round[];
  /** The add-reviewer dialog is open. */
  addingReviewer: boolean;
  onAddingReviewerChange: (open: boolean) => void;
  /** The form inside the add-reviewer dialog. */
  addReviewerForm: ReactNode;
};

const ROUND_STATUS_TONE: Readonly<Record<Round["status"], Tone>> = {
  open: "info",
  settled: "success",
  expired: "error",
};

const REVIEWER_STATUS: Readonly<
  Record<Reviewer["status"], { label: string; tone: Tone }>
> = {
  sent: { label: roundText.reviewerState.sent, tone: "info" },
  decided: { label: roundText.reviewerState.decided, tone: "success" },
  expired: { label: roundText.reviewerState.expired, tone: "error" },
  approve: { label: roundText.outcome.approve, tone: "success" },
  request_changes: {
    label: roundText.outcome.request_changes,
    tone: "warning",
  },
  comment: { label: roundText.outcome.comment, tone: "info" },
};

const FINDING_STATUS_TONE: Readonly<Record<Finding["status"], Tone>> = {
  pending: "info",
  incorporated: "success",
  dismissed: "info",
  replied: "info",
};

function getDownloadButtonLabel(
  downloading: boolean,
  selectedCount: number,
  totalCount: number,
): string {
  if (downloading) {
    return roundText.downloadingZipShort;
  }
  if (selectedCount === totalCount) {
    return roundText.downloadAllButton;
  }
  return roundText.downloadSelectedCount(selectedCount);
}

function FindingRow({ finding }: { finding: Finding }) {
  const scopeLabel =
    finding.slide === null
      ? roundText.overallScope
      : roundText.slidePrefix(finding.slide);
  const alreadyIncorporated = finding.status === "incorporated";

  return (
    <li className={styles.triageItem}>
      <div className={styles.triageInline}>
        <div className={styles.triageSummary}>
          <span className={styles.triageText}>{finding.text}</span>
          <span className={styles.triageMeta}>{scopeLabel}</span>
          {finding.status === "pending" ? null : (
            <QuietState tone={FINDING_STATUS_TONE[finding.status]} dot={false}>
              {roundText.triageStatus[finding.status]}
            </QuietState>
          )}
        </div>
        <div className={styles.triageActions}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.triageIconButton}
            data-action="incorporate"
            aria-label={roundText.incorporate}
            title={roundText.incorporate}
            disabled={finding.busy || alreadyIncorporated}
            onClick={finding.onIncorporate}
          >
            <Check className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.triageIconButton}
            data-action="dismiss"
            aria-label={roundText.dismiss}
            title={roundText.dismiss}
            disabled={
              finding.busy ||
              alreadyIncorporated ||
              finding.status === "dismissed"
            }
            onClick={finding.onDismiss}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {finding.fault === null ? null : <Fault>{finding.fault}</Fault>}
    </li>
  );
}

function PaneSlideDeck({
  title,
  deck,
  onBack,
}: {
  title: string;
  deck: Deck | null;
  onBack: () => void;
}) {
  const [slidesExpanded, setSlidesExpanded] = useState(false);

  return (
    <div className={styles.paneSlidesView} data-slot="pane-slide-deck">
      <div className={styles.paneSlidesBar}>
        <LeanButton type="button" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          {wording.shell.back}
        </LeanButton>
        <strong className={styles.paneSlidesTitle}>{title}</strong>
        <LeanButton
          type="button"
          aria-label={wording.preview.expand}
          title={wording.preview.expand}
          onClick={() => setSlidesExpanded(true)}
        >
          <Maximize2 size={14} aria-hidden="true" />
        </LeanButton>
      </div>
      {deck === null ? (
        <InlineNote>{wording.approvalPackage.unreadable}</InlineNote>
      ) : (
        <SlidesView deck={deck} />
      )}
      <Dialog open={slidesExpanded} onOpenChange={setSlidesExpanded}>
        <DialogContent className={styles.slideDeckDialog}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div
            className={styles.slideDeckModalBody}
            data-slot="slide-deck-modal"
          >
            {deck === null ? (
              <InlineNote>{wording.approvalPackage.unreadable}</InlineNote>
            ) : (
              <SlidesView deck={deck} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DownloadDialog({ reviewer }: { reviewer: Reviewer }) {
  const { download } = reviewer;
  const { open, files, downloading } = download;
  const selectedCount = files.filter((file) => file.included).length;

  return (
    <Dialog open={open} onOpenChange={download.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {roundText.downloadDialogTitle(reviewer.name)}
          </DialogTitle>
          <DialogDescription>{reviewer.persona}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className={styles.downloadHead}>
            <InlineNote as="span">{roundText.downloadSectionLead}</InlineNote>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={download.onToggleAllFiles}
            >
              {selectedCount === files.length
                ? roundText.deselectAllFiles
                : roundText.selectAllFiles}
            </Button>
          </div>
          <ul className={styles.checklist}>
            {files.map(({ path, label, included, onOpenSource }) => (
              <li key={path}>
                {onOpenSource === null ? (
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => download.onToggleFile(path)}
                    />
                    <span>{label}</span>
                  </label>
                ) : (
                  <div className={styles.checkRow}>
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={included}
                      onChange={() => download.onToggleFile(path)}
                    />
                    <SourceLink onClick={onOpenSource}>{label}</SourceLink>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => download.onOpenChange(false)}
          >
            {wording.action.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={downloading || selectedCount === 0}
            onClick={download.onDownload}
          >
            {getDownloadButtonLabel(downloading, selectedCount, files.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaveField({
  saving,
  onSave,
}: {
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <FieldSaveButton type="button" disabled={saving} onClick={onSave}>
      {saving ? roundText.savingField : roundText.saveField}
    </FieldSaveButton>
  );
}

function ReviewerRow({
  reviewer,
  editable,
  isExpanded,
  onToggleExpand,
  onViewSlides,
}: {
  reviewer: Reviewer;
  /** The round is open, so the drawer's fields can be changed and saved. */
  editable: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onViewSlides: () => void;
}) {
  const { fields, unsaved, savingDetails, savingDecision } = reviewer;
  const status = REVIEWER_STATUS[reviewer.status];
  const saveDetails = (
    <SaveField saving={savingDetails} onSave={reviewer.onSaveDetails} />
  );

  return (
    <li
      className={styles.reviewer}
      data-expanded={isExpanded ? "true" : "false"}
    >
      <button
        type="button"
        className={styles.rowToggle}
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
      >
        <span className={styles.chevron} aria-hidden="true">
          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <strong className={styles.cellName}>{reviewer.name}</strong>
        <span className={styles.cellRole}>{reviewer.persona}</span>
        <span className={styles.cellGoal}>{reviewer.goal}</span>
        <span className={styles.cellStatus} data-cell="status">
          <QuietState tone={status.tone} dot={false}>
            {status.label}
          </QuietState>
        </span>
      </button>
      <div
        className={styles.drawer}
        data-slot="reviewer-drawer"
        hidden={!isExpanded}
      >
        {reviewer.fault === null ? null : <Fault>{reviewer.fault}</Fault>}
        <ApprovalFields>
          <ApprovalField
            label={roundText.fieldLabels.name}
            action={editable && unsaved.name ? saveDetails : null}
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.reviewerName}`}
              value={fields.name}
              disabled={!editable}
              onChange={(event) =>
                reviewer.onEdit({ name: event.target.value })
              }
            />
          </ApprovalField>
          <ApprovalField
            label={roundText.fieldLabels.role}
            action={editable && unsaved.persona ? saveDetails : null}
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.reviewerPersona}`}
              value={fields.persona}
              disabled={!editable}
              onChange={(event) =>
                reviewer.onEdit({ persona: event.target.value })
              }
            />
          </ApprovalField>
          <ApprovalField
            label={roundText.fieldLabels.focus}
            action={editable && unsaved.goal ? saveDetails : null}
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.reviewerGoal}`}
              placeholder={roundText.defaultGoal(reviewer.persona)}
              value={fields.goal}
              disabled={!editable}
              onChange={(event) =>
                reviewer.onEdit({ goal: event.target.value })
              }
            />
          </ApprovalField>
          <ApprovalField
            label={roundText.fieldLabels.decision}
            action={
              editable && unsaved.outcome ? (
                <SaveField
                  saving={savingDecision}
                  onSave={reviewer.onSaveOutcome}
                />
              ) : null
            }
          >
            <LeanSelect
              aria-label={`${reviewer.name} ${roundText.outcomeLabel}`}
              value={fields.outcome}
              disabled={!editable}
              onChange={(event) =>
                reviewer.onEdit({
                  outcome: event.target.value as ReviewerOutcome | "",
                })
              }
            >
              <option value="">{roundText.pendingOutcome}</option>
              {OUTCOME_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {roundText.outcome[option]}
                </option>
              ))}
            </LeanSelect>
          </ApprovalField>
          <ApprovalField
            label={roundText.fieldLabels.feedback}
            action={
              editable && unsaved.note ? (
                <SaveField
                  saving={savingDecision}
                  onSave={reviewer.onSaveNote}
                />
              ) : null
            }
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.noteLabel}`}
              placeholder={roundText.inlineFeedbackPlaceholder}
              value={fields.note}
              disabled={!editable}
              onChange={(event) =>
                reviewer.onEdit({ note: event.target.value })
              }
            />
          </ApprovalField>
        </ApprovalFields>
        <div className={styles.reviewerActions}>
          {reviewer.deck === null ? (
            <LeanButton
              type="button"
              disabled={reviewer.generatingDeck}
              onClick={reviewer.onGenerateDeck}
            >
              <Presentation size={14} aria-hidden="true" />
              {reviewer.generatingDeck
                ? roundText.generatingSlideDeck
                : roundText.generateSlideDeck}
            </LeanButton>
          ) : (
            <>
              <LeanButton type="button" onClick={onViewSlides}>
                <Presentation size={14} aria-hidden="true" />
                {roundText.viewSlideDeck}
              </LeanButton>
              <LeanButton
                type="button"
                aria-label={roundText.downloadReviewerZip(reviewer.name)}
                onClick={reviewer.download.onOpen}
              >
                <Download size={14} aria-hidden="true" />
                {roundText.downloadZipShort}
              </LeanButton>
            </>
          )}
        </div>
        {reviewer.findings.length === 0 ? null : (
          <div className={styles.reviewerDecision}>
            <ul
              className={styles.triageList}
              aria-label={roundText.triageHeading}
            >
              {reviewer.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          </div>
        )}
      </div>
      <DownloadDialog reviewer={reviewer} />
    </li>
  );
}

function RoundSection({ round, flush }: { round: Round; flush: boolean }) {
  const [viewingSlides, setViewingSlides] = useState<{
    title: string;
    deck: Deck | null;
  } | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>();
    const first = round.reviewers[0]?.id;
    if (first !== undefined) {
      initial.add(first);
    }
    for (const reviewer of round.reviewers) {
      if (reviewer.justAdded) {
        initial.add(reviewer.id);
      }
    }
    return initial;
  });

  // A reviewer added while the round is on screen opens too.
  const justAdded = round.reviewers
    .filter((reviewer) => reviewer.justAdded)
    .map((reviewer) => reviewer.id);
  useEffect(() => {
    setExpandedIds((current) => new Set([...current, ...justAdded]));
  }, [justAdded.join("\n")]);

  const toggleExpanded = (reviewerId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(reviewerId)) {
        next.delete(reviewerId);
      } else {
        next.add(reviewerId);
      }
      return next;
    });
  };

  return (
    <section
      className={styles.round}
      aria-label={roundText.roundHeading(round.packageVersion)}
    >
      {flush ? null : (
        <header className={styles.roundMeta}>
          <strong>{roundText.roundHeading(round.packageVersion)}</strong>
          <QuietState tone={ROUND_STATUS_TONE[round.status]} dot={false}>
            {roundText.roundStatus[round.status]}
          </QuietState>
        </header>
      )}
      {round.fault === null ? null : <Fault>{round.fault}</Fault>}
      {viewingSlides !== null ? (
        <PaneSlideDeck
          title={viewingSlides.title}
          deck={viewingSlides.deck}
          onBack={() => setViewingSlides(null)}
        />
      ) : (
        <>
          <div className={styles.table}>
            <div className={styles.tableHead} aria-hidden="true">
              <span />
              <span>{roundText.tableHeaders.reviewer}</span>
              <span>{roundText.tableHeaders.role}</span>
              <span>{roundText.tableHeaders.goal}</span>
              <span>{roundText.tableHeaders.status}</span>
            </div>
            <ul className={styles.list}>
              {round.reviewers.map((reviewer) => (
                <ReviewerRow
                  key={reviewer.id}
                  reviewer={reviewer}
                  editable={round.status === "open"}
                  isExpanded={expandedIds.has(reviewer.id)}
                  onToggleExpand={() => toggleExpanded(reviewer.id)}
                  onViewSlides={() =>
                    setViewingSlides({
                      title: roundText.slideDeckDialogTitle(
                        reviewer.name,
                        reviewer.persona,
                      ),
                      deck: reviewer.deck,
                    })
                  }
                />
              ))}
            </ul>
          </div>
          {round.status === "settled" ? null : (
            <div className={styles.editorActions}>
              <LeanButton
                type="button"
                disabled={!round.canSettle || round.settling}
                onClick={round.onSettle}
              >
                {round.settling
                  ? roundText.settlingRound
                  : roundText.settleRound}
              </LeanButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ApprovalRoundsView({
  flush,
  loading,
  fault,
  packageDeck,
  rounds,
  addingReviewer,
  onAddingReviewerChange,
  addReviewerForm,
}: ApprovalRoundsViewProps) {
  const [emptySlidesOpen, setEmptySlidesOpen] = useState(false);

  const renderEmptyRoundsContent = () => {
    if (emptySlidesOpen) {
      return (
        <PaneSlideDeck
          title={wording.approvalPackage.label}
          deck={packageDeck}
          onBack={() => setEmptySlidesOpen(false)}
        />
      );
    }
    return (
      <div className={styles.empty}>
        <InlineNote>{roundText.empty}</InlineNote>
        {packageDeck === null ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEmptySlidesOpen(true)}
          >
            <Presentation size={14} aria-hidden="true" />
            {roundText.viewSlideDeck}
          </Button>
        )}
      </div>
    );
  };

  const renderRoundsContent = () => {
    if (loading) {
      return <InlineNote role="status">{roundText.loading}</InlineNote>;
    }
    if (rounds.length === 0) {
      return renderEmptyRoundsContent();
    }
    return (
      <div className={styles.rounds}>
        {rounds.map((round) => (
          <RoundSection key={round.id} round={round} flush={flush} />
        ))}
      </div>
    );
  };

  return (
    <section className={styles.panel} aria-label={roundText.heading}>
      {flush ? null : (
        <>
          <header className={styles.header}>
            <h2>{roundText.heading}</h2>
            <div className={styles.headerActions}>
              <Button
                type="button"
                size="sm"
                variant={addingReviewer ? "outline" : "primary"}
                onClick={() => onAddingReviewerChange(!addingReviewer)}
              >
                {roundText.shareButton}
              </Button>
            </div>
          </header>
          <InlineNote>{roundText.lead}</InlineNote>
        </>
      )}
      {fault === null ? null : <Fault>{fault}</Fault>}
      <Dialog open={addingReviewer} onOpenChange={onAddingReviewerChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{roundText.shareFormLegend}</DialogTitle>
            <DialogDescription>{roundText.dialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogBody>{addReviewerForm}</DialogBody>
        </DialogContent>
      </Dialog>
      {renderRoundsContent()}
    </section>
  );
}
