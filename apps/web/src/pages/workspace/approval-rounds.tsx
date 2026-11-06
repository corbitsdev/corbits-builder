import { Button, Switch } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import type {
  ApprovalPackageBundle,
  ApprovalPackageSource,
} from "@corbits-builder/schemas/artifact";
import type {
  ApprovalReviewer,
  ApprovalRound,
  ApprovalRoundStatus,
  ExpiryPreset,
  ReviewerInput,
  ReviewerOutcome,
  ReviewerState,
  TriageAction,
  TriageItem,
  TriageItemStatus,
} from "@corbits-builder/schemas/approval-round";
import JSZip from "jszip";
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
import { useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  downloadApprovalPackageZip,
  listApprovalRounds,
  recordReviewerDecision,
  settleApprovalRound,
  startApprovalRound,
  triageReviewerFeedback,
} from "../../api/artifacts.ts";
import { sendMessage } from "../../api/conversation.ts";
import { Fault, InlineNote, QuietState, type Tone } from "../../components.jsx";
import { wording } from "../../config.ts";
import { queryClient } from "../../queries/client.ts";
import { keys } from "../../queries/keys.ts";
import {
  addCustomReviewerPersona,
  addWorkspaceReviewer,
  allReviewerPersonas,
  mergeWorkspaceReviewers,
  useCustomReviewerPersonas,
  useWorkspaceReviewers,
} from "../../workspace-approvals-setting.ts";
import {
  ApprovalField,
  ApprovalFields,
  FieldSaveButton,
  LeanButton,
  LeanInput,
  LeanSelect,
} from "../approval-fields.tsx";
import {
  ApprovalPackagePreview,
  parseApprovalPackage,
  SlidesView,
} from "./approval-package-preview.tsx";
import styles from "./approval-rounds.module.css";
import { humanFault, responseCode } from "./human-fault.ts";
import { DesignTarget } from "./mockup-tweaks.tsx";
import type { PassageQuote } from "./passage-note.tsx";
import { SourceLink } from "./source-link.tsx";

const roundText = wording.approvalRound;
const OTHER_PERSONA_VALUE = "__other__";
const EXPIRY_OPTIONS: readonly ExpiryPreset[] = ["24h", "7d", "30d"];
const OUTCOME_OPTIONS: readonly ReviewerOutcome[] = [
  "approve",
  "request_changes",
  "comment",
];

const ROUND_STATUS_TONE: Readonly<Record<ApprovalRoundStatus, Tone>> = {
  open: "info",
  settled: "success",
  expired: "error",
};

const REVIEWER_STATE_TONE: Readonly<Record<ReviewerState, Tone>> = {
  sent: "info",
  decided: "success",
  expired: "error",
};

const OUTCOME_TONE: Readonly<Record<ReviewerOutcome, Tone>> = {
  approve: "success",
  request_changes: "warning",
  comment: "info",
};

const TRIAGE_STATUS_TONE: Readonly<Record<TriageItemStatus, Tone>> = {
  pending: "info",
  incorporated: "success",
  dismissed: "info",
  replied: "info",
};

function triggerBrowserDownload(file: File) {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const href = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = href;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href));
}

function getEffectiveReviewerGoal(reviewer: ApprovalReviewer): string {
  if (reviewer.goal !== undefined && reviewer.goal.trim() !== "") {
    return reviewer.goal.trim();
  }
  return roundText.defaultGoal(reviewer.persona);
}

function getReviewerStatusDisplay(reviewer: ApprovalReviewer): {
  label: string;
  tone: Tone;
} {
  if (reviewer.decision !== undefined) {
    return {
      label: roundText.outcome[reviewer.decision.outcome],
      tone: OUTCOME_TONE[reviewer.decision.outcome],
    };
  }
  return {
    label: roundText.reviewerState[reviewer.state],
    tone: REVIEWER_STATE_TONE[reviewer.state],
  };
}

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

function normalizePersonaToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const KNOWN_PERSONA_TOKENS: ReadonlySet<string> = new Set(
  roundText.reviewerPersonas.map((persona) => normalizePersonaToken(persona)),
);

export function doesBundleMatchReviewer(
  bundle: ApprovalPackageBundle,
  reviewer: { name: string; persona: string },
): boolean {
  const personaToken = normalizePersonaToken(reviewer.persona);
  if (personaToken === "") return false;
  const audienceRaw = bundle.manifest.audience.trim().toLowerCase();
  const audienceToken = normalizePersonaToken(bundle.manifest.audience);
  if (audienceToken !== "") {
    if (audienceToken === personaToken) return true;
    if (
      audienceToken.startsWith(`${personaToken}_`) ||
      audienceToken.endsWith(`_${personaToken}`) ||
      audienceToken.includes(`_${personaToken}_`)
    ) {
      return true;
    }
  }
  const reviewerNameLower = reviewer.name.trim().toLowerCase();
  if (reviewerNameLower !== "") {
    if (audienceRaw.includes(reviewerNameLower)) return true;
    if (
      bundle.manifest.decisionNeeded.toLowerCase().includes(reviewerNameLower)
    ) {
      return true;
    }
  }
  return false;
}

export function resolveReviewerPackage({
  reviewer,
  reviewerIndex,
  round,
  bundlesByVersion,
  fallbackBundle,
  newlyAddedReviewerIds,
}: {
  reviewer: ApprovalReviewer;
  reviewerIndex: number;
  round: ApprovalRound;
  bundlesByVersion: ReadonlyMap<number, ApprovalPackageBundle>;
  fallbackBundle: ApprovalPackageBundle | null;
  newlyAddedReviewerIds?: ReadonlySet<string> | undefined;
}): {
  bundle: ApprovalPackageBundle | null;
  packageVersion: number;
  hasCuratedDeck: boolean;
} {
  const sortedVersions = [...bundlesByVersion.keys()].sort((a, b) => b - a);
  for (const version of sortedVersions) {
    const candidate = bundlesByVersion.get(version);
    if (
      candidate !== undefined &&
      doesBundleMatchReviewer(candidate, reviewer)
    ) {
      return {
        bundle: candidate,
        packageVersion: version,
        hasCuratedDeck: true,
      };
    }
  }
  if (
    fallbackBundle !== null &&
    doesBundleMatchReviewer(fallbackBundle, reviewer)
  ) {
    return {
      bundle: fallbackBundle,
      packageVersion: round.packageVersion,
      hasCuratedDeck: true,
    };
  }
  const fallbackAudienceToken =
    fallbackBundle === null
      ? ""
      : normalizePersonaToken(fallbackBundle.manifest.audience);
  const reviewerPersonaToken = normalizePersonaToken(reviewer.persona);
  const isFallbackGeneric =
    fallbackBundle !== null &&
    !KNOWN_PERSONA_TOKENS.has(fallbackAudienceToken) &&
    !round.reviewers.some((other) =>
      doesBundleMatchReviewer(fallbackBundle, other),
    );
  const isReviewerNewlyAdded = newlyAddedReviewerIds?.has(reviewer.id) === true;
  if (
    fallbackBundle !== null &&
    reviewerIndex === 0 &&
    !isReviewerNewlyAdded &&
    isFallbackGeneric &&
    !KNOWN_PERSONA_TOKENS.has(reviewerPersonaToken)
  ) {
    return {
      bundle: fallbackBundle,
      packageVersion: round.packageVersion,
      hasCuratedDeck: true,
    };
  }
  return {
    bundle: null,
    packageVersion: round.packageVersion,
    hasCuratedDeck: false,
  };
}

type ReviewerDraft = ReviewerInput & {
  key: string;
  workspaceReviewerId?: string | undefined;
  customPersonaOpen?: boolean | undefined;
  customPersonaDraft?: string | undefined;
};

export function SharePackageDialog({
  projectId,
  packageVersion,
  onCreated,
  onCancel,
  onFault,
}: {
  projectId: string;
  packageVersion: number;
  onCreated: (round: ApprovalRound) => void;
  onCancel: () => void;
  onFault: (message: string | null) => void;
}) {
  const workspaceReviewers = useWorkspaceReviewers();
  const customPersonas = useCustomReviewerPersonas();
  const personaOptions = allReviewerPersonas(
    customPersonas,
    workspaceReviewers,
  );
  const [expiry, setExpiry] = useState<ExpiryPreset>("7d");
  const [reviewers, setReviewers] = useState<ReviewerDraft[]>([
    { key: "reviewer-1", name: "", persona: "" },
  ]);
  const [starting, setStarting] = useState(false);

  const setReviewerField = (
    rowKey: string,
    field: "name" | "persona" | "email" | "goal",
    value: string,
  ) => {
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        return {
          ...entry,
          [field]: value,
          ...(field === "name" ? { workspaceReviewerId: undefined } : {}),
        };
      }),
    );
  };

  const selectWorkspaceReviewer = (rowKey: string, workspaceId: string) => {
    const match = workspaceReviewers.find((entry) => entry.id === workspaceId);
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        if (match === undefined) {
          return { ...entry, workspaceReviewerId: undefined };
        }
        return {
          ...entry,
          workspaceReviewerId: match.id,
          name: match.name,
          persona: match.persona,
          ...(match.email === undefined ? {} : { email: match.email }),
          ...(match.goal === undefined ? {} : { goal: match.goal }),
          customPersonaOpen: false,
          customPersonaDraft: undefined,
          saveToWorkspace: false,
        };
      }),
    );
  };

  const selectReviewerPersona = (rowKey: string, value: string) => {
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        if (value === OTHER_PERSONA_VALUE) {
          return {
            ...entry,
            persona: "",
            customPersonaOpen: true,
            customPersonaDraft: "",
          };
        }
        return {
          ...entry,
          persona: value,
          customPersonaOpen: false,
          customPersonaDraft: undefined,
        };
      }),
    );
  };

  const setCustomPersonaDraft = (rowKey: string, value: string) => {
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        return {
          ...entry,
          customPersonaDraft: value,
          persona: value,
        };
      }),
    );
  };

  const commitCustomPersona = (rowKey: string) => {
    const target = reviewers.find((entry) => entry.key === rowKey);
    const trimmed =
      target?.customPersonaDraft === undefined
        ? ""
        : target.customPersonaDraft.trim();
    if (trimmed === "") return;
    addCustomReviewerPersona(trimmed);
    setReviewers((current) =>
      current.map((entry) => {
        if (entry.key !== rowKey) return entry;
        return {
          ...entry,
          persona: trimmed,
          customPersonaOpen: false,
          customPersonaDraft: undefined,
        };
      }),
    );
  };

  const setSaveToWorkspace = (rowKey: string, checked: boolean) => {
    setReviewers((current) =>
      current.map((entry) =>
        entry.key === rowKey ? { ...entry, saveToWorkspace: checked } : entry,
      ),
    );
  };

  const canStartRound =
    reviewers.length > 0 &&
    reviewers.every(
      (reviewer) =>
        reviewer.name.trim() !== "" && reviewer.persona.trim() !== "",
    );

  const handleStartRound = async () => {
    const valid = reviewers
      .map((reviewer) => ({
        name: reviewer.name.trim(),
        persona: reviewer.persona.trim(),
        ...(reviewer.email !== undefined && reviewer.email.trim() !== ""
          ? { email: reviewer.email.trim() }
          : {}),
        ...(reviewer.goal !== undefined && reviewer.goal.trim() !== ""
          ? { goal: reviewer.goal.trim() }
          : {}),
        ...(reviewer.saveToWorkspace === true ? { saveToWorkspace: true } : {}),
      }))
      .filter((reviewer) => reviewer.name !== "" && reviewer.persona !== "");
    if (valid.length === 0) return;
    for (const reviewer of valid) {
      addCustomReviewerPersona(reviewer.persona);
      if (reviewer.saveToWorkspace === true) {
        addWorkspaceReviewer({
          name: reviewer.name,
          persona: reviewer.persona,
          ...(reviewer.email === undefined ? {} : { email: reviewer.email }),
          ...(reviewer.goal === undefined ? {} : { goal: reviewer.goal }),
        });
      }
    }
    setStarting(true);
    onFault(null);
    try {
      const created = await startApprovalRound(projectId, {
        packageVersion,
        expiry,
        reviewers: valid,
      });
      void queryClient.invalidateQueries({
        queryKey: keys.projectRoom.of(projectId),
      });
      onCreated(created);
    } catch (error) {
      onFault(humanFault(error, roundText.failed));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      className={styles.shareDialog}
      role="dialog"
      aria-label={roundText.dialogTitle}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className={styles.shareReviewers}>
        {reviewers.map((reviewer, index) => {
          const rowLabel = roundText.reviewerRowLabel(index + 1);
          const selectedWorkspaceId =
            reviewer.workspaceReviewerId === undefined
              ? ""
              : reviewer.workspaceReviewerId;
          const selectedPersonaValue =
            reviewer.customPersonaOpen === true
              ? OTHER_PERSONA_VALUE
              : reviewer.persona;
          const customPersonaValue =
            reviewer.customPersonaDraft === undefined
              ? ""
              : reviewer.customPersonaDraft;
          const showSaveToggle = reviewer.workspaceReviewerId === undefined;
          return (
            <ApprovalFields
              key={reviewer.key}
              variant="form"
              role="group"
              aria-label={rowLabel}
            >
              {workspaceReviewers.length === 0 ? null : (
                <ApprovalField label={roundText.fieldLabels.saved}>
                  <LeanSelect
                    aria-label={`${rowLabel} ${roundText.workspaceReviewerLabel}`}
                    value={selectedWorkspaceId}
                    onChange={(event) =>
                      selectWorkspaceReviewer(reviewer.key, event.target.value)
                    }
                  >
                    <option value="">
                      {roundText.workspaceReviewerPlaceholder}
                    </option>
                    {workspaceReviewers.map((saved) => (
                      <option key={saved.id} value={saved.id}>
                        {roundText.workspaceReviewerOption(
                          saved.name,
                          saved.persona,
                        )}
                      </option>
                    ))}
                  </LeanSelect>
                </ApprovalField>
              )}
              <ApprovalField label={roundText.fieldLabels.name}>
                <LeanInput
                  aria-label={`${rowLabel} ${roundText.reviewerName}`}
                  placeholder={roundText.reviewerNamePlaceholder}
                  value={reviewer.name}
                  onChange={(event) =>
                    setReviewerField(reviewer.key, "name", event.target.value)
                  }
                />
              </ApprovalField>
              <ApprovalField label={roundText.fieldLabels.role}>
                <LeanSelect
                  aria-label={`${rowLabel} ${roundText.reviewerPersona}`}
                  value={selectedPersonaValue}
                  onChange={(event) =>
                    selectReviewerPersona(reviewer.key, event.target.value)
                  }
                >
                  <option value="">
                    {roundText.reviewerPersonaPlaceholder}
                  </option>
                  {personaOptions.map((persona) => (
                    <option key={persona} value={persona}>
                      {persona}
                    </option>
                  ))}
                  <option value={OTHER_PERSONA_VALUE}>
                    {roundText.otherPersona}
                  </option>
                </LeanSelect>
              </ApprovalField>
              {reviewer.customPersonaOpen === true ? (
                <ApprovalField label={roundText.customPersonaLabel}>
                  <LeanInput
                    aria-label={`${rowLabel} ${roundText.customPersonaLabel}`}
                    placeholder={roundText.customPersonaPlaceholder}
                    value={customPersonaValue}
                    onChange={(event) =>
                      setCustomPersonaDraft(reviewer.key, event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitCustomPersona(reviewer.key);
                      }
                    }}
                  />
                  <FieldSaveButton
                    type="button"
                    onClick={() => commitCustomPersona(reviewer.key)}
                  >
                    {roundText.addCustomPersona}
                  </FieldSaveButton>
                </ApprovalField>
              ) : null}
              <ApprovalField label={roundText.fieldLabels.focus}>
                <LeanInput
                  aria-label={`${rowLabel} ${roundText.reviewerGoal}`}
                  placeholder={roundText.reviewerGoalPlaceholder}
                  value={reviewer.goal === undefined ? "" : reviewer.goal}
                  onChange={(event) =>
                    setReviewerField(reviewer.key, "goal", event.target.value)
                  }
                />
              </ApprovalField>
              <ApprovalField label={roundText.fieldLabels.email}>
                <LeanInput
                  type="email"
                  aria-label={`${rowLabel} ${roundText.reviewerEmail}`}
                  placeholder={roundText.reviewerEmailPlaceholder}
                  value={reviewer.email === undefined ? "" : reviewer.email}
                  onChange={(event) =>
                    setReviewerField(reviewer.key, "email", event.target.value)
                  }
                />
              </ApprovalField>
              {showSaveToggle ? (
                <ApprovalField
                  label={roundText.fieldLabels.workspace}
                  title={roundText.saveToWorkspaceTooltip}
                >
                  <div className={styles.saveToggle}>
                    <Switch
                      label={roundText.saveToWorkspaceLabel(
                        reviewer.name.trim(),
                      )}
                      checked={reviewer.saveToWorkspace === true}
                      onCheckedChange={(checked) =>
                        setSaveToWorkspace(reviewer.key, checked)
                      }
                    />
                    <InlineNote as="span">
                      {roundText.saveToWorkspaceNote}
                    </InlineNote>
                  </div>
                </ApprovalField>
              ) : null}
              <ApprovalField label={roundText.fieldLabels.expires}>
                <LeanSelect
                  aria-label={roundText.expiryLabel}
                  value={expiry}
                  onChange={(event) =>
                    setExpiry(event.target.value as ExpiryPreset)
                  }
                >
                  {EXPIRY_OPTIONS.map((preset) => (
                    <option key={preset} value={preset}>
                      {roundText.expiry[preset]}
                    </option>
                  ))}
                </LeanSelect>
              </ApprovalField>
            </ApprovalFields>
          );
        })}
      </div>
      <div className={styles.shareActions}>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {roundText.cancelShare}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={starting || !canStartRound}
          onClick={() => void handleStartRound()}
        >
          {starting ? roundText.startingRound : roundText.shareSubmitButton}
        </Button>
      </div>
    </div>
  );
}

function TriageItemRow({
  projectId,
  round,
  item,
  onAddToPrompt,
  onUpdated,
}: {
  projectId: string;
  round: ApprovalRound;
  item: TriageItem;
  onAddToPrompt?: ((passage: PassageQuote) => void) | undefined;
  onUpdated: (round: ApprovalRound) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const runTriage = async (action: TriageAction) => {
    if (action === "incorporate" && onAddToPrompt !== undefined) {
      onAddToPrompt({
        title: `${item.reviewerName} (${item.persona})`,
        version: round.packageVersion,
        quote: item.text,
      });
    }
    const nextStatus: TriageItemStatus =
      action === "incorporate" ? "incorporated" : "dismissed";
    const optimisticRound: ApprovalRound = {
      ...round,
      triage: round.triage.map((entry) =>
        entry.itemId === item.itemId ? { ...entry, status: nextStatus } : entry,
      ),
    };
    onUpdated(optimisticRound);
    setBusy(true);
    setFault(null);
    try {
      const updated = await triageReviewerFeedback(
        projectId,
        round.roundId,
        item.itemId,
        { action },
      );
      if (action === "incorporate") {
        void queryClient.invalidateQueries({
          queryKey: keys.projectRoom.of(projectId),
        });
      }
      onUpdated(updated);
    } catch (error) {
      const code = await responseCode(error);
      if (
        action === "incorporate" &&
        onAddToPrompt !== undefined &&
        code === "coordinator_not_running"
      ) {
        return;
      }
      onUpdated(round);
      setFault(humanFault(error, roundText.failed));
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel =
    item.slide === undefined
      ? roundText.overallScope
      : roundText.slidePrefix(item.slide);
  const alreadyIncorporated = item.status === "incorporated";

  return (
    <li className={styles.triageItem}>
      <div className={styles.triageInline}>
        <div className={styles.triageSummary}>
          <span className={styles.triageText}>{item.text}</span>
          <span className={styles.triageMeta}>{scopeLabel}</span>
          {item.status === "pending" ? null : (
            <QuietState tone={TRIAGE_STATUS_TONE[item.status]} dot={false}>
              {roundText.triageStatus[item.status]}
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
            disabled={busy || alreadyIncorporated}
            onClick={() => void runTriage("incorporate")}
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
              busy || alreadyIncorporated || item.status === "dismissed"
            }
            onClick={() => void runTriage("dismiss")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {fault === null ? null : <Fault>{fault}</Fault>}
    </li>
  );
}

function renderReviewerDecisionSection(
  projectId: string,
  round: ApprovalRound,
  reviewer: ApprovalReviewer,
  reviewerItems: readonly TriageItem[],
  onAddToPrompt: ((passage: PassageQuote) => void) | undefined,
  onUpdated: (round: ApprovalRound) => void,
) {
  if (reviewer.decision === undefined || reviewerItems.length === 0) {
    return null;
  }
  return (
    <div className={styles.reviewerDecision}>
      <ul className={styles.triageList} aria-label={roundText.triageHeading}>
        {reviewerItems.map((item) => (
          <TriageItemRow
            key={item.itemId}
            projectId={projectId}
            round={round}
            item={item}
            onAddToPrompt={onAddToPrompt}
            onUpdated={onUpdated}
          />
        ))}
      </ul>
    </div>
  );
}

function PaneSlideDeckView({
  title,
  bundle,
  onBack,
}: {
  title: string;
  bundle: ApprovalPackageBundle | null;
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
      {bundle === null ? (
        <InlineNote>{wording.approvalPackage.unreadable}</InlineNote>
      ) : (
        <SlidesView deck={bundle.deck} />
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
            {bundle === null ? (
              <InlineNote>{wording.approvalPackage.unreadable}</InlineNote>
            ) : (
              <SlidesView deck={bundle.deck} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function filterZipArchiveEntries(
  file: File,
  excludedPaths: ReadonlySet<string>,
): Promise<File> {
  if (excludedPaths.size === 0) return file;
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  for (const path of excludedPaths) {
    archive.remove(path);
  }
  const bytes = await archive.generateAsync({ type: "uint8array" });
  return new File([bytes as BlobPart], file.name, { type: "application/zip" });
}

function ReviewerTableRow({
  projectId,
  round,
  reviewer,
  bundle,
  packageVersion,
  hasCuratedDeck,
  isGeneratingDeck,
  onGeneratingChange,
  onOpenSource,
  onAddToPrompt,
  onDeliverMessage,
  onViewSlides,
  isExpanded,
  onToggleExpand,
  onUpdated,
}: {
  projectId: string;
  round: ApprovalRound;
  reviewer: ApprovalReviewer;
  bundle: ApprovalPackageBundle | null;
  packageVersion: number;
  hasCuratedDeck: boolean;
  isGeneratingDeck: boolean;
  onGeneratingChange: (generating: boolean) => void;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
  onAddToPrompt?: ((passage: PassageQuote) => void) | undefined;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  onViewSlides: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdated: (round: ApprovalRound) => void;
}) {
  const effectiveGoal = getEffectiveReviewerGoal(reviewer);
  const savedGoal = reviewer.goal === undefined ? "" : reviewer.goal;
  const currentOutcome: ReviewerOutcome | "" =
    reviewer.decision === undefined ? "" : reviewer.decision.outcome;
  const currentNote =
    reviewer.decision === undefined || reviewer.decision.note === undefined
      ? ""
      : reviewer.decision.note;

  const [nameDraft, setNameDraft] = useState(reviewer.name);
  const [personaDraft, setPersonaDraft] = useState(reviewer.persona);
  const [goalDraft, setGoalDraft] = useState(savedGoal);
  const [outcomeDraft, setOutcomeDraft] = useState<ReviewerOutcome | "">(
    currentOutcome,
  );
  const [noteDraft, setNoteDraft] = useState(currentNote);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [excludedPaths, setExcludedPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [generatingDeck, setGeneratingDeck] = useState(false);
  const [rowFault, setRowFault] = useState<string | null>(null);

  useEffect(() => {
    if (hasCuratedDeck) {
      setGeneratingDeck(false);
    }
  }, [hasCuratedDeck]);

  useEffect(() => {
    setNameDraft(reviewer.name);
    setPersonaDraft(reviewer.persona);
    setGoalDraft(reviewer.goal === undefined ? "" : reviewer.goal);
    setOutcomeDraft(
      reviewer.decision === undefined ? "" : reviewer.decision.outcome,
    );
    setNoteDraft(
      reviewer.decision === undefined || reviewer.decision.note === undefined
        ? ""
        : reviewer.decision.note,
    );
  }, [reviewer.name, reviewer.persona, reviewer.goal, reviewer.decision]);

  const nameDirty =
    nameDraft.trim() !== "" && nameDraft.trim() !== reviewer.name;
  const personaDirty =
    personaDraft.trim() !== "" && personaDraft.trim() !== reviewer.persona;
  const goalDirty = goalDraft.trim() !== savedGoal;
  const detailsDirty = nameDirty || personaDirty || goalDirty;
  const outcomeDirty = outcomeDraft !== "" && outcomeDraft !== currentOutcome;
  const noteDirty = noteDraft.trim() !== currentNote;

  const reviewerItems = round.triage.filter(
    (item) => item.reviewerId === reviewer.id,
  );
  const sources: readonly ApprovalPackageSource[] =
    bundle === null ? [] : bundle.manifest.sources;
  const allPackagePaths = [
    "deck.pptx",
    "deck.pdf",
    ...sources.map((source) => `documents/${source.kind}.md`),
  ];
  const totalCheckableItems = allPackagePaths.length;
  const selectedCount = Math.max(0, totalCheckableItems - excludedPaths.size);

  const openDownloadDialog = () => {
    setExcludedPaths(new Set<string>());
    setDownloadOpen(true);
  };

  const togglePackageEntry = (path: string) => {
    setExcludedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleSelectAllPackageEntries = () => {
    if (selectedCount === totalCheckableItems) {
      setExcludedPaths(new Set(allPackagePaths));
    } else {
      setExcludedPaths(new Set<string>());
    }
  };

  const saveReviewerDetails = async () => {
    const nextName = nameDraft.trim();
    const nextPersona = personaDraft.trim();
    const nextGoal = goalDraft.trim();
    if (nextName === "" || nextPersona === "") return;
    setSavingDetails(true);
    setRowFault(null);
    try {
      const updated = await recordReviewerDecision(
        projectId,
        round.roundId,
        reviewer.id,
        {
          name: nextName,
          persona: nextPersona,
          goal: nextGoal,
        },
      );
      onUpdated(updated);
      toast.success(roundText.reviewerDetailsSaved(nextName));
    } catch (error) {
      setRowFault(humanFault(error, roundText.failed));
    } finally {
      setSavingDetails(false);
    }
  };

  const saveInlineDecision = async (useDefaultFeedbackOutcome: boolean) => {
    let resolvedOutcome: ReviewerOutcome = "request_changes";
    if (outcomeDraft !== "") {
      resolvedOutcome = outcomeDraft;
    } else if (!useDefaultFeedbackOutcome && currentOutcome !== "") {
      resolvedOutcome = currentOutcome;
    }
    const trimmedNote = noteDraft.trim();
    setSavingDecision(true);
    setRowFault(null);
    try {
      const updated = await recordReviewerDecision(
        projectId,
        round.roundId,
        reviewer.id,
        {
          outcome: resolvedOutcome,
          ...(trimmedNote === "" ? {} : { note: trimmedNote }),
        },
      );
      onUpdated(updated);
    } catch (error) {
      setRowFault(humanFault(error, roundText.failed));
    } finally {
      setSavingDecision(false);
    }
  };

  const downloadForReviewer = async () => {
    setDownloading(true);
    setRowFault(null);
    try {
      const rawFile = await downloadApprovalPackageZip(
        projectId,
        packageVersion,
        {
          name: nameDraft.trim() || reviewer.name,
          persona: personaDraft.trim() || reviewer.persona,
          reviewerId: reviewer.id,
          roundId: round.roundId,
        },
      );
      const file = await filterZipArchiveEntries(rawFile, excludedPaths);
      triggerBrowserDownload(file);
      toast.success(wording.paneFile.downloaded(file.name));
      setDownloadOpen(false);
    } catch (error) {
      setRowFault(humanFault(error, roundText.failed));
    } finally {
      setDownloading(false);
    }
  };

  const askCoordinatorToTailor = async () => {
    const activeName = nameDraft.trim() || reviewer.name;
    const activePersona = personaDraft.trim() || reviewer.persona;
    const activeGoal = goalDraft.trim() || effectiveGoal;
    const promptText = roundText.tailorPrompt(
      activeName,
      activePersona,
      activeGoal,
    );
    setTailoring(true);
    setGeneratingDeck(true);
    onGeneratingChange(true);
    setRowFault(null);
    try {
      if (detailsDirty && round.status === "open") {
        const updated = await recordReviewerDecision(
          projectId,
          round.roundId,
          reviewer.id,
          {
            name: activeName,
            persona: activePersona,
            goal: activeGoal,
          },
        );
        onUpdated(updated);
      }
      if (onDeliverMessage !== undefined) {
        const delivered = await onDeliverMessage(promptText);
        if (delivered === false) {
          setGeneratingDeck(false);
          onGeneratingChange(false);
          return;
        }
      } else {
        await sendMessage(projectId, promptText);
        void queryClient.invalidateQueries({
          queryKey: keys.projectRoom.of(projectId),
        });
      }
      toast.success(roundText.tailorRequested(activeName));
    } catch (error) {
      setGeneratingDeck(false);
      onGeneratingChange(false);
      setRowFault(humanFault(error, roundText.failed));
    } finally {
      setTailoring(false);
    }
  };

  const statusDisplay = getReviewerStatusDisplay(reviewer);
  const isGenerating = tailoring || generatingDeck || isGeneratingDeck;
  const generateLabel = isGenerating
    ? roundText.generatingSlideDeck
    : roundText.generateSlideDeck;

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
        <span className={styles.cellGoal}>{effectiveGoal}</span>
        <span className={styles.cellStatus} data-cell="status">
          <QuietState tone={statusDisplay.tone} dot={false}>
            {statusDisplay.label}
          </QuietState>
        </span>
      </button>
      <div
        className={styles.drawer}
        data-slot="reviewer-drawer"
        hidden={!isExpanded}
      >
        {rowFault === null ? null : <Fault>{rowFault}</Fault>}
        <ApprovalFields>
          <ApprovalField
            label={roundText.fieldLabels.name}
            action={
              round.status === "open" && nameDirty ? (
                <FieldSaveButton
                  type="button"
                  disabled={savingDetails}
                  onClick={() => void saveReviewerDetails()}
                >
                  {savingDetails ? roundText.savingField : roundText.saveField}
                </FieldSaveButton>
              ) : null
            }
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.reviewerName}`}
              value={nameDraft}
              disabled={round.status !== "open"}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </ApprovalField>
          <ApprovalField
            label={roundText.fieldLabels.role}
            action={
              round.status === "open" && personaDirty ? (
                <FieldSaveButton
                  type="button"
                  disabled={savingDetails}
                  onClick={() => void saveReviewerDetails()}
                >
                  {savingDetails ? roundText.savingField : roundText.saveField}
                </FieldSaveButton>
              ) : null
            }
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.reviewerPersona}`}
              value={personaDraft}
              disabled={round.status !== "open"}
              onChange={(event) => setPersonaDraft(event.target.value)}
            />
          </ApprovalField>
          <ApprovalField
            label={roundText.fieldLabels.focus}
            action={
              round.status === "open" && goalDirty ? (
                <FieldSaveButton
                  type="button"
                  disabled={savingDetails}
                  onClick={() => void saveReviewerDetails()}
                >
                  {savingDetails ? roundText.savingField : roundText.saveField}
                </FieldSaveButton>
              ) : null
            }
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.reviewerGoal}`}
              placeholder={roundText.defaultGoal(reviewer.persona)}
              value={goalDraft}
              disabled={round.status !== "open"}
              onChange={(event) => setGoalDraft(event.target.value)}
            />
          </ApprovalField>
          <ApprovalField
            label={roundText.fieldLabels.decision}
            action={
              round.status === "open" && outcomeDirty ? (
                <FieldSaveButton
                  type="button"
                  disabled={savingDecision}
                  onClick={() => void saveInlineDecision(false)}
                >
                  {savingDecision ? roundText.savingField : roundText.saveField}
                </FieldSaveButton>
              ) : null
            }
          >
            <LeanSelect
              aria-label={`${reviewer.name} ${roundText.outcomeLabel}`}
              value={outcomeDraft}
              disabled={round.status !== "open"}
              onChange={(event) =>
                setOutcomeDraft(event.target.value as ReviewerOutcome | "")
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
              round.status === "open" && noteDirty ? (
                <FieldSaveButton
                  type="button"
                  disabled={savingDecision}
                  onClick={() => void saveInlineDecision(true)}
                >
                  {savingDecision ? roundText.savingField : roundText.saveField}
                </FieldSaveButton>
              ) : null
            }
          >
            <LeanInput
              aria-label={`${reviewer.name} ${roundText.noteLabel}`}
              placeholder={roundText.inlineFeedbackPlaceholder}
              value={noteDraft}
              disabled={round.status !== "open"}
              onChange={(event) => setNoteDraft(event.target.value)}
            />
          </ApprovalField>
        </ApprovalFields>
        <div className={styles.reviewerActions}>
          {hasCuratedDeck ? (
            <>
              <LeanButton type="button" onClick={onViewSlides}>
                <Presentation size={14} aria-hidden="true" />
                {roundText.viewSlideDeck}
              </LeanButton>
              <LeanButton
                type="button"
                aria-label={roundText.downloadReviewerZip(reviewer.name)}
                onClick={openDownloadDialog}
              >
                <Download size={14} aria-hidden="true" />
                {roundText.downloadZipShort}
              </LeanButton>
            </>
          ) : (
            <LeanButton
              type="button"
              disabled={isGenerating}
              onClick={() => void askCoordinatorToTailor()}
            >
              <Presentation size={14} aria-hidden="true" />
              {generateLabel}
            </LeanButton>
          )}
        </div>
        {renderReviewerDecisionSection(
          projectId,
          round,
          reviewer,
          reviewerItems,
          onAddToPrompt,
          onUpdated,
        )}
      </div>
      <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
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
                onClick={toggleSelectAllPackageEntries}
              >
                {selectedCount === totalCheckableItems
                  ? roundText.deselectAllFiles
                  : roundText.selectAllFiles}
              </Button>
            </div>
            <ul className={styles.checklist}>
              <li>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={!excludedPaths.has("deck.pptx")}
                    onChange={() => togglePackageEntry("deck.pptx")}
                  />
                  <span>{roundText.packageItemPptx}</span>
                </label>
              </li>
              <li>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={!excludedPaths.has("deck.pdf")}
                    onChange={() => togglePackageEntry("deck.pdf")}
                  />
                  <span>{roundText.packageItemPdf}</span>
                </label>
              </li>
              {sources.map((source) => {
                const docPath = `documents/${source.kind}.md`;
                const kindLabel =
                  wording.documentTab[source.kind] ?? source.kind;
                return (
                  <li key={`${source.artifactId}:${String(source.version)}`}>
                    <div className={styles.checkRow}>
                      <input
                        type="checkbox"
                        aria-label={roundText.packageItemSource(
                          kindLabel,
                          source.title,
                          source.version,
                        )}
                        checked={!excludedPaths.has(docPath)}
                        onChange={() => togglePackageEntry(docPath)}
                      />
                      <SourceLink
                        onClick={() =>
                          onOpenSource?.(source.kind, source.version)
                        }
                      >
                        {roundText.packageItemSource(
                          kindLabel,
                          source.title,
                          source.version,
                        )}
                      </SourceLink>
                    </div>
                  </li>
                );
              })}
            </ul>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDownloadOpen(false)}
            >
              {wording.action.cancel}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={downloading || selectedCount === 0}
              onClick={() => void downloadForReviewer()}
            >
              {getDownloadButtonLabel(
                downloading,
                selectedCount,
                totalCheckableItems,
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function RoundCard({
  projectId,
  round,
  bundle,
  bundlesByVersion,
  newlyAddedReviewerIds,
  generatingReviewerIds,
  onReviewerGeneratingChange,
  flush = false,
  onOpenSource,
  onAddToPrompt,
  onDeliverMessage,
  onUpdated,
}: {
  projectId: string;
  round: ApprovalRound;
  bundle: ApprovalPackageBundle | null;
  bundlesByVersion: ReadonlyMap<number, ApprovalPackageBundle>;
  newlyAddedReviewerIds: ReadonlySet<string>;
  generatingReviewerIds: ReadonlySet<string>;
  onReviewerGeneratingChange: (reviewerId: string, generating: boolean) => void;
  flush?: boolean | undefined;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
  onAddToPrompt?: ((passage: PassageQuote) => void) | undefined;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  onUpdated: (round: ApprovalRound) => void;
}) {
  const [settling, setSettling] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [viewingSlides, setViewingSlides] = useState<{
    reviewer: ApprovalReviewer;
    bundle: ApprovalPackageBundle | null;
  } | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>();
    const first = round.reviewers[0]?.id;
    if (first !== undefined) {
      initial.add(first);
    }
    for (const reviewer of round.reviewers) {
      if (newlyAddedReviewerIds.has(reviewer.id)) {
        initial.add(reviewer.id);
      }
    }
    return initial;
  });

  useEffect(() => {
    setExpandedIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const reviewer of round.reviewers) {
        if (newlyAddedReviewerIds.has(reviewer.id) && !next.has(reviewer.id)) {
          next.add(reviewer.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [round.reviewers, newlyAddedReviewerIds]);

  const canSettle =
    round.status !== "settled" &&
    round.reviewers.every((reviewer) => reviewer.state !== "sent");

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

  const settle = async () => {
    setSettling(true);
    setFault(null);
    try {
      const updated = await settleApprovalRound(projectId, round.roundId);
      onUpdated(updated);
    } catch (error) {
      setFault(humanFault(error, roundText.failed));
    } finally {
      setSettling(false);
    }
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
      {fault === null ? null : <Fault>{fault}</Fault>}
      {viewingSlides !== null ? (
        <PaneSlideDeckView
          title={roundText.slideDeckDialogTitle(
            viewingSlides.reviewer.name,
            viewingSlides.reviewer.persona,
          )}
          bundle={viewingSlides.bundle}
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
              {round.reviewers.map((reviewer, reviewerIndex) => {
                const resolved = resolveReviewerPackage({
                  reviewer,
                  reviewerIndex,
                  round,
                  bundlesByVersion,
                  fallbackBundle: bundle,
                  newlyAddedReviewerIds,
                });
                return (
                  <ReviewerTableRow
                    key={reviewer.id}
                    projectId={projectId}
                    round={round}
                    reviewer={reviewer}
                    bundle={resolved.bundle}
                    packageVersion={resolved.packageVersion}
                    hasCuratedDeck={resolved.hasCuratedDeck}
                    isGeneratingDeck={
                      !resolved.hasCuratedDeck &&
                      generatingReviewerIds.has(reviewer.id)
                    }
                    onGeneratingChange={(generating) =>
                      onReviewerGeneratingChange(reviewer.id, generating)
                    }
                    onOpenSource={onOpenSource}
                    onAddToPrompt={onAddToPrompt}
                    onDeliverMessage={onDeliverMessage}
                    onViewSlides={() =>
                      setViewingSlides({
                        reviewer,
                        bundle: resolved.bundle,
                      })
                    }
                    isExpanded={expandedIds.has(reviewer.id)}
                    onToggleExpand={() => toggleExpanded(reviewer.id)}
                    onUpdated={onUpdated}
                  />
                );
              })}
            </ul>
          </div>
          {round.status === "settled" ? null : (
            <div className={styles.editorActions}>
              <LeanButton
                type="button"
                disabled={!canSettle || settling}
                onClick={() => void settle()}
              >
                {settling ? roundText.settlingRound : roundText.settleRound}
              </LeanButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ApprovalRoundsPanel({
  projectId,
  packageVersion,
  packageContent,
  packageVersions,
  packageBundlesByVersion,
  onReadPackageVersion,
  onOpenSource,
  onAddToPrompt,
  onDeliverMessage,
  initialRounds,
  initialShareOpen = false,
  flush = false,
  shareOpen: controlledShareOpen,
  onShareOpenChange,
  isAddReviewerOpen,
  onCloseAddReviewer,
}: {
  projectId: string;
  packageVersion: number;
  packageContent?: string;
  packageVersions?: readonly number[] | undefined;
  packageBundlesByVersion?:
    | ReadonlyMap<number, ApprovalPackageBundle>
    | undefined;
  onReadPackageVersion?: ((version: number) => Promise<string>) | undefined;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
  onAddToPrompt?: ((passage: PassageQuote) => void) | undefined;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  initialRounds?: readonly ApprovalRound[];
  initialShareOpen?: boolean;
  flush?: boolean | undefined;
  shareOpen?: boolean | undefined;
  onShareOpenChange?: ((open: boolean) => void) | undefined;
  isAddReviewerOpen?: boolean | undefined;
  onCloseAddReviewer?: (() => void) | undefined;
}) {
  const bundle =
    packageContent === undefined ? null : parseApprovalPackage(packageContent);
  const [fetchedBundles, setFetchedBundles] = useState<
    ReadonlyMap<number, ApprovalPackageBundle>
  >(() => new Map<number, ApprovalPackageBundle>());
  const [newlyAddedReviewerIds, setNewlyAddedReviewerIds] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [generatingReviewerIds, setGeneratingReviewerIds] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [rounds, setRounds] = useState<ApprovalRound[]>(
    initialRounds === undefined ? [] : [...initialRounds],
  );
  const [loading, setLoading] = useState(initialRounds === undefined);
  const [fault, setFault] = useState<string | null>(null);
  const [internalShareOpen, setInternalShareOpen] = useState(initialShareOpen);
  const [emptySlidesOpen, setEmptySlidesOpen] = useState(false);

  const readPackageRef = useRef(onReadPackageVersion);
  readPackageRef.current = onReadPackageVersion;

  const bundlesByVersion = new Map<number, ApprovalPackageBundle>(
    fetchedBundles,
  );
  if (packageBundlesByVersion !== undefined) {
    for (const [ver, bdl] of packageBundlesByVersion) {
      bundlesByVersion.set(ver, bdl);
    }
  }
  if (bundle !== null) {
    bundlesByVersion.set(packageVersion, bundle);
  }

  useEffect(() => {
    const reader = readPackageRef.current;
    if (reader === undefined) return;
    const versionsToLoad = new Set<number>(
      packageVersions === undefined ? [] : packageVersions,
    );
    for (const round of rounds) {
      versionsToLoad.add(round.packageVersion);
    }
    let cancelled = false;
    async function loadVersion(
      ver: number,
      read: (version: number) => Promise<string>,
    ) {
      try {
        const raw = await read(ver);
        if (cancelled) return;
        const parsed = parseApprovalPackage(raw);
        if (parsed === null) return;
        setFetchedBundles((current) => {
          if (current.has(ver)) return current;
          const next = new Map(current);
          next.set(ver, parsed);
          return next;
        });
      } catch (error) {
        if (!cancelled) setFault(humanFault(error, roundText.failed));
      }
    }
    for (const ver of versionsToLoad) {
      if (ver === packageVersion && bundle !== null) continue;
      if (fetchedBundles.has(ver)) continue;
      void loadVersion(ver, reader);
    }
    return () => {
      cancelled = true;
    };
  }, [packageVersions, rounds, packageVersion, bundle, fetchedBundles]);

  const shareOpen =
    isAddReviewerOpen ?? controlledShareOpen ?? internalShareOpen;
  const setShareOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(shareOpen) : next;
    setInternalShareOpen(resolved);
    onShareOpenChange?.(resolved);
    if (!resolved) {
      onCloseAddReviewer?.();
    }
  };

  useEffect(() => {
    if (initialRounds !== undefined) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await listApprovalRounds(projectId);
        if (!cancelled) {
          setRounds(result.rounds);
          if (result.workspaceReviewers !== undefined) {
            mergeWorkspaceReviewers(result.workspaceReviewers);
          }
        }
      } catch (error) {
        if (!cancelled) setFault(humanFault(error, roundText.failed));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, initialRounds]);

  const updateRound = (updated: ApprovalRound) => {
    setRounds((current) =>
      current.map((item) =>
        item.roundId === updated.roundId ? updated : item,
      ),
    );
  };

  const setReviewerGenerating = (reviewerId: string, generating: boolean) => {
    setGeneratingReviewerIds((current) => {
      if (generating && current.has(reviewerId)) return current;
      if (!generating && !current.has(reviewerId)) return current;
      const next = new Set(current);
      if (generating) {
        next.add(reviewerId);
      } else {
        next.delete(reviewerId);
      }
      return next;
    });
  };

  const handleRoundCreated = (created: ApprovalRound) => {
    const existingReviewerIds = new Set(
      rounds.flatMap((round) => round.reviewers.map((rev) => rev.id)),
    );
    const addedReviewers = created.reviewers.filter(
      (rev) => !existingReviewerIds.has(rev.id),
    );
    if (addedReviewers.length > 0) {
      setNewlyAddedReviewerIds((current) => {
        const next = new Set(current);
        for (const rev of addedReviewers) {
          next.add(rev.id);
        }
        return next;
      });
      async function requestTailorForAddedReviewer(rev: ApprovalReviewer) {
        const effectiveGoal = getEffectiveReviewerGoal(rev);
        const promptText = roundText.tailorPrompt(
          rev.name,
          rev.persona,
          effectiveGoal,
        );
        try {
          if (onDeliverMessage !== undefined) {
            const delivered = await onDeliverMessage(promptText);
            if (delivered === false) {
              setReviewerGenerating(rev.id, false);
              return;
            }
          } else {
            await sendMessage(projectId, promptText);
            void queryClient.invalidateQueries({
              queryKey: keys.projectRoom.of(projectId),
            });
          }
          toast.success(roundText.tailorRequested(rev.name));
        } catch (error) {
          setReviewerGenerating(rev.id, false);
          setFault(humanFault(error, roundText.failed));
        }
      }
      for (const rev of addedReviewers) {
        const hasMatch = [...bundlesByVersion.values()].some((candidate) =>
          doesBundleMatchReviewer(candidate, rev),
        );
        if (!hasMatch) {
          setReviewerGenerating(rev.id, true);
          void requestTailorForAddedReviewer(rev);
        }
      }
    }
    setRounds((current) => {
      const exists = current.some((item) => item.roundId === created.roundId);
      if (exists) {
        return current.map((item) =>
          item.roundId === created.roundId ? created : item,
        );
      }
      return [created, ...current];
    });
    setShareOpen(false);
  };

  const renderEmptyRoundsContent = () => {
    if (emptySlidesOpen) {
      return (
        <PaneSlideDeckView
          title={wording.approvalPackage.label}
          bundle={bundle}
          onBack={() => setEmptySlidesOpen(false)}
        />
      );
    }
    return (
      <div className={styles.empty}>
        <InlineNote>{roundText.empty}</InlineNote>
        {bundle === null ? null : (
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
          <RoundCard
            key={round.roundId}
            projectId={projectId}
            round={round}
            bundle={bundle}
            bundlesByVersion={bundlesByVersion}
            newlyAddedReviewerIds={newlyAddedReviewerIds}
            generatingReviewerIds={generatingReviewerIds}
            onReviewerGeneratingChange={setReviewerGenerating}
            flush={flush}
            onOpenSource={onOpenSource}
            onAddToPrompt={onAddToPrompt}
            onDeliverMessage={onDeliverMessage}
            onUpdated={updateRound}
          />
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
                variant={shareOpen ? "outline" : "primary"}
                onClick={() => setShareOpen((current) => !current)}
              >
                {roundText.shareButton}
              </Button>
            </div>
          </header>
          <InlineNote>{roundText.lead}</InlineNote>
        </>
      )}
      {fault === null ? null : <Fault>{fault}</Fault>}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{roundText.shareFormLegend}</DialogTitle>
            <DialogDescription>{roundText.dialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <SharePackageDialog
              projectId={projectId}
              packageVersion={packageVersion}
              onCreated={handleRoundCreated}
              onCancel={() => setShareOpen(false)}
              onFault={setFault}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
      {renderRoundsContent()}
    </section>
  );
}

export function ContextualApprovalRounds({
  packageVersion,
  packageContent,
  packageVersions,
  onReadPackageVersion,
  onOpenSource,
  onAddToPrompt,
  onDeliverMessage,
  shareOpen,
  onShareOpenChange,
  isAddReviewerOpen,
  onCloseAddReviewer,
}: {
  packageVersion: number;
  packageContent?: string;
  packageVersions?: readonly number[] | undefined;
  onReadPackageVersion?: ((version: number) => Promise<string>) | undefined;
  onOpenSource?: ((kind: string, version: number) => void) | undefined;
  onAddToPrompt?: ((passage: PassageQuote) => void) | undefined;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  shareOpen?: boolean | undefined;
  onShareOpenChange?: ((open: boolean) => void) | undefined;
  isAddReviewerOpen?: boolean | undefined;
  onCloseAddReviewer?: (() => void) | undefined;
}) {
  const target = useContext(DesignTarget);
  if (target === null) {
    if (packageContent === undefined) {
      return null;
    }
    return (
      <>
        <aside className={styles.packageReminder} role="note">
          <InlineNote>{wording.approvalPackage.reminder}</InlineNote>
        </aside>
        <ApprovalPackagePreview
          content={packageContent}
          {...(onOpenSource === undefined ? {} : { onOpenSource })}
        />
      </>
    );
  }
  return (
    <ApprovalRoundsPanel
      projectId={target.projectId}
      packageVersion={packageVersion}
      flush
      {...(packageContent === undefined ? {} : { packageContent })}
      {...(packageVersions === undefined ? {} : { packageVersions })}
      {...(onReadPackageVersion === undefined ? {} : { onReadPackageVersion })}
      {...(onOpenSource === undefined ? {} : { onOpenSource })}
      {...(onAddToPrompt === undefined ? {} : { onAddToPrompt })}
      {...(onDeliverMessage === undefined ? {} : { onDeliverMessage })}
      {...(shareOpen === undefined ? {} : { shareOpen })}
      {...(onShareOpenChange === undefined ? {} : { onShareOpenChange })}
      {...(isAddReviewerOpen === undefined ? {} : { isAddReviewerOpen })}
      {...(onCloseAddReviewer === undefined ? {} : { onCloseAddReviewer })}
    />
  );
}
