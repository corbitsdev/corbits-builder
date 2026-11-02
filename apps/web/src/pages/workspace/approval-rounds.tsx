import {
  Badge,
  Button,
  Input,
  Select,
  Switch,
  Textarea,
} from "@corbits/react-ui";
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
import { Download, Paperclip } from "lucide-react";
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
import { humanFault } from "./human-fault.ts";
import { DesignTarget } from "./mockup-tweaks.tsx";

const roundText = wording.approvalRound;
const OTHER_PERSONA_VALUE = "__other__";
const EXPIRY_OPTIONS: readonly ExpiryPreset[] = ["24h", "7d", "30d"];
const OUTCOME_OPTIONS: readonly ReviewerOutcome[] = [
  "approve",
  "request_changes",
  "comment",
];

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const ROUND_STATUS_TONE: Readonly<Record<ApprovalRoundStatus, BadgeTone>> = {
  open: "neutral",
  settled: "neutral",
  expired: "neutral",
};

const REVIEWER_STATE_TONE: Readonly<Record<ReviewerState, BadgeTone>> = {
  sent: "neutral",
  decided: "neutral",
  expired: "neutral",
};

const OUTCOME_TONE: Readonly<Record<ReviewerOutcome, BadgeTone>> = {
  approve: "neutral",
  request_changes: "neutral",
  comment: "neutral",
};

const TRIAGE_STATUS_TONE: Readonly<Record<TriageItemStatus, BadgeTone>> = {
  pending: "neutral",
  incorporated: "neutral",
  dismissed: "neutral",
  replied: "neutral",
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

type ReviewerDraft = ReviewerInput & {
  key: string;
  workspaceReviewerId?: string | undefined;
  customPersonaOpen?: boolean | undefined;
  customPersonaDraft?: string | undefined;
};

type AttachedFeedbackFile = {
  name: string;
  block: string;
};

export function ReviewerDecisionEditor({
  projectId,
  roundId,
  reviewer,
  onUpdated,
}: {
  projectId: string;
  roundId: string;
  reviewer: ApprovalReviewer;
  onUpdated: (round: ApprovalRound) => void;
}) {
  const existing = reviewer.decision;
  const initialOutcome: ReviewerOutcome =
    existing === undefined ? "approve" : existing.outcome;
  const initialNote =
    existing === undefined || existing.note === undefined ? "" : existing.note;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ReviewerOutcome>(initialOutcome);
  const [note, setNote] = useState(initialNote);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFeedbackFile[]>(
    [],
  );
  const [saving, setSaving] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const resetFromDecision = () => {
    const current = reviewer.decision;
    setOutcome(current === undefined ? "approve" : current.outcome);
    setNote(
      current === undefined || current.note === undefined ? "" : current.note,
    );
    setAttachedFiles([]);
    setFault(null);
  };

  const openEditor = () => {
    resetFromDecision();
    setOpen(true);
  };

  const cancelEditor = () => {
    resetFromDecision();
    setOpen(false);
  };

  const readAttachedFiles = async (fileList: FileList | null) => {
    if (fileList === null || fileList.length === 0) return;
    setFault(null);
    try {
      const additions: AttachedFeedbackFile[] = [];
      for (const file of Array.from(fileList)) {
        const raw = await file.text();
        const trimmed = raw.trim();
        if (trimmed === "") continue;
        additions.push({
          name: file.name,
          block: `### ${file.name}\n${trimmed}`,
        });
      }
      if (additions.length === 0) return;
      setAttachedFiles((current) => [...current, ...additions]);
      setNote((current) => {
        const blocks = additions.map((entry) => entry.block).join("\n\n");
        return current.trim() === ""
          ? blocks
          : `${current.trim()}\n\n${blocks}`;
      });
    } catch (error) {
      setFault(humanFault(error, roundText.failed));
    }
  };

  const removeAttachedFile = (index: number) => {
    const target = attachedFiles[index];
    if (target === undefined) return;
    setAttachedFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setNote((current) =>
      current
        .replace(target.block, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
  };

  const submit = async () => {
    setSaving(true);
    setFault(null);
    try {
      const trimmed = note.trim();
      const updated = await recordReviewerDecision(
        projectId,
        roundId,
        reviewer.id,
        {
          outcome,
          ...(trimmed === "" ? {} : { note: trimmed }),
        },
      );
      onUpdated(updated);
      setOpen(false);
    } catch (error) {
      setFault(humanFault(error, roundText.failed));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={openEditor}>
        {existing === undefined
          ? roundText.recordDecision
          : roundText.amendDecision}
      </Button>
    );
  }

  return (
    <div
      className="approval-reviewer-editor"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void readAttachedFiles(event.dataTransfer.files);
      }}
    >
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
      <label className="approval-share-field">
        <span>{roundText.outcomeLabel}</span>
        <Select
          aria-label={roundText.outcomeLabel}
          value={outcome}
          onChange={(event) =>
            setOutcome(event.target.value as ReviewerOutcome)
          }
        >
          {OUTCOME_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {roundText.outcome[option]}
            </option>
          ))}
        </Select>
      </label>
      <label className="approval-share-field">
        <span>{roundText.noteLabel}</span>
        <Textarea
          aria-label={roundText.noteLabel}
          placeholder={roundText.notePlaceholder}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="approval-feedback-attachments">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv,.json"
          className="sr-only"
          aria-label={roundText.attachFeedbackFile}
          onChange={(event) => {
            void readAttachedFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <div className="approval-feedback-attach-bar">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={14} aria-hidden="true" />
            {roundText.attachFeedbackFile}
          </Button>
          <span className="inline-note">{roundText.attachFeedbackHint}</span>
        </div>
        {attachedFiles.length === 0 ? null : (
          <div className="approval-feedback-file-list">
            {attachedFiles.map((file, idx) => (
              <div
                key={`${file.name}:${String(idx)}`}
                className="approval-feedback-file-pill"
              >
                <Badge tone="neutral">{file.name}</Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={roundText.removeAttachedFile(file.name)}
                  onClick={() => removeAttachedFile(idx)}
                >
                  {roundText.removeReviewer}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="approval-editor-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? roundText.savingDecision : roundText.saveDecision}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancelEditor}>
          {wording.action.cancel}
        </Button>
      </div>
    </div>
  );
}

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
  const nextRowKey = useRef(2);
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
    field: "name" | "persona" | "email",
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

  const addReviewerRow = () => {
    const key = `reviewer-${String(nextRowKey.current)}`;
    nextRowKey.current += 1;
    setReviewers((current) => [...current, { key, name: "", persona: "" }]);
  };

  const removeReviewerRow = (rowKey: string) => {
    setReviewers((current) => current.filter((entry) => entry.key !== rowKey));
  };

  const handleStartRound = async () => {
    const valid = reviewers
      .map((reviewer) => ({
        name: reviewer.name.trim(),
        persona: reviewer.persona.trim(),
        ...(reviewer.email !== undefined && reviewer.email.trim() !== ""
          ? { email: reviewer.email.trim() }
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
      for (const reviewer of created.reviewers) {
        const file = await downloadApprovalPackageZip(
          projectId,
          created.packageVersion,
          {
            name: reviewer.name,
            persona: reviewer.persona,
            reviewerId: reviewer.id,
            roundId: created.roundId,
          },
        );
        triggerBrowserDownload(file);
        toast.success(wording.paneFile.downloaded(file.name));
      }
    } catch (error) {
      onFault(humanFault(error, roundText.failed));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      className="approval-share-dialog"
      role="dialog"
      aria-label={roundText.dialogTitle}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <label className="approval-share-field">
        <span>{roundText.expiryLabel}</span>
        <Select
          aria-label={roundText.expiryLabel}
          value={expiry}
          onChange={(event) => setExpiry(event.target.value as ExpiryPreset)}
        >
          {EXPIRY_OPTIONS.map((preset) => (
            <option key={preset} value={preset}>
              {roundText.expiry[preset]}
            </option>
          ))}
        </Select>
      </label>
      <div className="approval-share-reviewers">
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
            <div
              key={reviewer.key}
              className="approval-share-reviewer-row"
              role="group"
              aria-label={rowLabel}
            >
              {workspaceReviewers.length === 0 ? null : (
                <Select
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
                </Select>
              )}
              <Input
                aria-label={`${rowLabel} ${roundText.reviewerName}`}
                placeholder={roundText.reviewerName}
                value={reviewer.name}
                onChange={(event) =>
                  setReviewerField(reviewer.key, "name", event.target.value)
                }
              />
              <Select
                aria-label={`${rowLabel} ${roundText.reviewerPersona}`}
                value={selectedPersonaValue}
                onChange={(event) =>
                  selectReviewerPersona(reviewer.key, event.target.value)
                }
              >
                <option value="">{roundText.reviewerPersonaPlaceholder}</option>
                {personaOptions.map((persona) => (
                  <option key={persona} value={persona}>
                    {persona}
                  </option>
                ))}
                <option value={OTHER_PERSONA_VALUE}>
                  {roundText.otherPersona}
                </option>
              </Select>
              {reviewer.customPersonaOpen === true ? (
                <div className="approval-custom-persona-row">
                  <Input
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => commitCustomPersona(reviewer.key)}
                  >
                    {roundText.addCustomPersona}
                  </Button>
                </div>
              ) : null}
              <Input
                aria-label={`${rowLabel} ${roundText.reviewerEmail}`}
                placeholder={roundText.reviewerEmail}
                value={reviewer.email === undefined ? "" : reviewer.email}
                onChange={(event) =>
                  setReviewerField(reviewer.key, "email", event.target.value)
                }
              />
              {showSaveToggle ? (
                <div
                  className="approval-save-workspace-toggle"
                  title={roundText.saveToWorkspaceTooltip}
                >
                  <Switch
                    label={roundText.saveToWorkspaceLabel(reviewer.name.trim())}
                    checked={reviewer.saveToWorkspace === true}
                    onCheckedChange={(checked) =>
                      setSaveToWorkspace(reviewer.key, checked)
                    }
                  />
                </div>
              ) : null}
              {reviewers.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeReviewerRow(reviewer.key)}
                >
                  {roundText.removeReviewer}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="approval-share-actions">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={addReviewerRow}
        >
          {roundText.addReviewer}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={starting}
          onClick={() => void handleStartRound()}
        >
          {starting ? roundText.startingRound : roundText.startRound}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {roundText.cancelShare}
        </Button>
      </div>
    </div>
  );
}

function TriageItemRow({
  projectId,
  roundId,
  item,
  onUpdated,
}: {
  projectId: string;
  roundId: string;
  item: TriageItem;
  onUpdated: (round: ApprovalRound) => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(
    item.reply === undefined ? "" : item.reply,
  );
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const runTriage = async (action: TriageAction, reply?: string) => {
    setBusy(true);
    setFault(null);
    try {
      const updated = await triageReviewerFeedback(
        projectId,
        roundId,
        item.itemId,
        {
          action,
          ...(reply === undefined ? {} : { reply }),
        },
      );
      onUpdated(updated);
      setReplyOpen(false);
    } catch (error) {
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
    <li className="approval-triage-item">
      <div className="tweak-row approval-triage-summary">
        <span className="approval-triage-meta">
          {item.reviewerName} ({item.persona}) · {scopeLabel}
        </span>
        <Badge tone={TRIAGE_STATUS_TONE[item.status]}>
          {roundText.triageStatus[item.status]}
        </Badge>
      </div>
      <p className="approval-triage-text">{item.text}</p>
      {item.reply === undefined ? null : (
        <p className="inline-note approval-triage-reply">
          {roundText.ownerReplyLabel(item.reply)}
        </p>
      )}
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
      <div className="tweak-actions approval-triage-actions">
        <Button
          type="button"
          size="sm"
          disabled={busy || alreadyIncorporated}
          onClick={() => void runTriage("incorporate")}
        >
          {roundText.incorporate}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || alreadyIncorporated || item.status === "dismissed"}
          onClick={() => void runTriage("dismiss")}
        >
          {roundText.dismiss}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || alreadyIncorporated}
          onClick={() => setReplyOpen((current) => !current)}
        >
          {roundText.reply}
        </Button>
      </div>
      {replyOpen && !alreadyIncorporated ? (
        <div className="tweak-actions approval-triage-reply-editor">
          <Input
            aria-label={roundText.reply}
            placeholder={roundText.replyPlaceholder}
            value={replyText}
            onChange={(event) => setReplyText(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || replyText.trim() === ""}
            onClick={() => void runTriage("reply", replyText.trim())}
          >
            {roundText.sendReply}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function RoundCard({
  projectId,
  round,
  onUpdated,
}: {
  projectId: string;
  round: ApprovalRound;
  onUpdated: (round: ApprovalRound) => void;
}) {
  const [settling, setSettling] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const canSettle =
    round.status !== "settled" &&
    round.reviewers.every((reviewer) => reviewer.state !== "sent");

  const downloadForReviewer = async (reviewer: ApprovalReviewer) => {
    setDownloadingId(reviewer.id);
    setFault(null);
    try {
      const file = await downloadApprovalPackageZip(
        projectId,
        round.packageVersion,
        {
          name: reviewer.name,
          persona: reviewer.persona,
          reviewerId: reviewer.id,
          roundId: round.roundId,
        },
      );
      triggerBrowserDownload(file);
      toast.success(wording.paneFile.downloaded(file.name));
    } catch (error) {
      setFault(humanFault(error, roundText.failed));
    } finally {
      setDownloadingId(null);
    }
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
      className="approval-round-card"
      aria-label={roundText.roundHeading(round.packageVersion)}
    >
      <header className="approval-round-meta">
        <strong>{roundText.roundHeading(round.packageVersion)}</strong>
        <Badge tone={ROUND_STATUS_TONE[round.status]}>
          {roundText.roundStatus[round.status]}
        </Badge>
      </header>
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
      <ul className="approval-reviewer-list">
        {round.reviewers.map((reviewer) => (
          <li key={reviewer.id} className="approval-reviewer-item">
            <div className="approval-reviewer-summary">
              <div className="approval-reviewer-identity">
                <strong>{reviewer.name}</strong>
                <Badge tone="neutral">{reviewer.persona}</Badge>
              </div>
              <div className="approval-reviewer-actions">
                <Badge tone={REVIEWER_STATE_TONE[reviewer.state]}>
                  {roundText.reviewerState[reviewer.state]}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={roundText.downloadReviewerZip(reviewer.name)}
                  disabled={downloadingId === reviewer.id}
                  onClick={() => void downloadForReviewer(reviewer)}
                >
                  <Download size={14} aria-hidden="true" />
                  {roundText.downloadZipShort}
                </Button>
                {round.status === "open" ? (
                  <ReviewerDecisionEditor
                    projectId={projectId}
                    roundId={round.roundId}
                    reviewer={reviewer}
                    onUpdated={onUpdated}
                  />
                ) : null}
              </div>
            </div>
            {reviewer.decision === undefined ? null : (
              <div className="approval-reviewer-decision">
                <div className="approval-reviewer-decision-header">
                  <Badge tone={OUTCOME_TONE[reviewer.decision.outcome]}>
                    {roundText.outcome[reviewer.decision.outcome]}
                  </Badge>
                </div>
                {reviewer.decision.note === undefined ? null : (
                  <p className="inline-note">{reviewer.decision.note}</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {round.triage.length === 0 ? null : (
        <div
          className="approval-triage-section"
          aria-label={roundText.triageHeading}
        >
          <h3>{roundText.triageHeading}</h3>
          <p className="inline-note">{roundText.triageLead}</p>
          <ul className="approval-triage-list">
            {round.triage.map((item) => (
              <TriageItemRow
                key={item.itemId}
                projectId={projectId}
                roundId={round.roundId}
                item={item}
                onUpdated={onUpdated}
              />
            ))}
          </ul>
        </div>
      )}
      {round.status === "settled" ? null : (
        <div className="approval-editor-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canSettle || settling}
            onClick={() => void settle()}
          >
            {settling ? roundText.settlingRound : roundText.settleRound}
          </Button>
        </div>
      )}
    </section>
  );
}

export function ApprovalRoundsPanel({
  projectId,
  packageVersion,
  initialRounds,
  initialShareOpen = false,
}: {
  projectId: string;
  packageVersion: number;
  initialRounds?: readonly ApprovalRound[];
  initialShareOpen?: boolean;
}) {
  const [rounds, setRounds] = useState<ApprovalRound[]>(
    initialRounds === undefined ? [] : [...initialRounds],
  );
  const [loading, setLoading] = useState(initialRounds === undefined);
  const [fault, setFault] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(initialShareOpen);

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

  const renderRoundsContent = () => {
    if (loading) {
      return (
        <p className="inline-note" role="status">
          {roundText.loading}
        </p>
      );
    }
    if (rounds.length === 0) {
      return <p className="inline-note">{roundText.empty}</p>;
    }
    return (
      <div className="approval-rounds-list">
        {rounds.map((round) => (
          <RoundCard
            key={round.roundId}
            projectId={projectId}
            round={round}
            onUpdated={updateRound}
          />
        ))}
      </div>
    );
  };

  return (
    <section className="approval-rounds-panel" aria-label={roundText.heading}>
      <header className="approval-rounds-header">
        <h2>{roundText.heading}</h2>
        <div className="approval-rounds-actions">
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
      <p className="inline-note">{roundText.lead}</p>
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
      {shareOpen ? (
        <SharePackageDialog
          projectId={projectId}
          packageVersion={packageVersion}
          onCreated={(created) => {
            setRounds((current) => [created, ...current]);
            setShareOpen(false);
          }}
          onCancel={() => setShareOpen(false)}
          onFault={setFault}
        />
      ) : null}
      {renderRoundsContent()}
    </section>
  );
}

export function ContextualApprovalRounds({
  packageVersion,
}: {
  packageVersion: number;
}) {
  const target = useContext(DesignTarget);
  if (target === null) return null;
  return (
    <ApprovalRoundsPanel
      projectId={target.projectId}
      packageVersion={packageVersion}
    />
  );
}
