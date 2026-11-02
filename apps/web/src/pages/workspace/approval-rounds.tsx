import { Button, Input, Select, Textarea } from "@corbits/react-ui";
import type {
  ApprovalReviewer,
  ApprovalRound,
  ExpiryPreset,
  ReviewerInput,
  ReviewerOutcome,
  SlideNote,
  TriageAction,
  TriageItem,
} from "@corbits-builder/schemas/approval-round";
import { useContext, useEffect, useState } from "react";
import {
  listApprovalRounds,
  recordReviewerDecision,
  settleApprovalRound,
  startApprovalRound,
  triageReviewerFeedback,
} from "../../api/artifacts.ts";
import { wording } from "../../config.ts";
import { humanFault } from "./human-fault.ts";
import { DesignTarget } from "./mockup-tweaks.tsx";

const roundText = wording.approvalRound;
const EXPIRY_OPTIONS: readonly ExpiryPreset[] = ["24h", "7d", "30d"];
const OUTCOME_OPTIONS: readonly ReviewerOutcome[] = [
  "approve",
  "request_changes",
  "comment",
];

function ReviewerDecisionEditor({
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
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ReviewerOutcome>(
    existing === undefined ? "approve" : existing.outcome,
  );
  const [note, setNote] = useState(
    existing === undefined || existing.note === undefined ? "" : existing.note,
  );
  const [slideNotes, setSlideNotes] = useState<SlideNote[]>(
    existing === undefined ? [] : existing.slideNotes,
  );
  const [slideInput, setSlideInput] = useState("1");
  const [slideText, setSlideText] = useState("");
  const [saving, setSaving] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const addSlideNote = () => {
    const slideNum = Number(slideInput);
    const trimmed = slideText.trim();
    if (!Number.isInteger(slideNum) || slideNum < 1 || trimmed === "") return;
    setSlideNotes((current) => [
      ...current,
      { slide: slideNum, text: trimmed },
    ]);
    setSlideText("");
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
          ...(slideNotes.length === 0 ? {} : { slideNotes }),
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {existing === undefined
          ? roundText.recordDecision
          : roundText.amendDecision}
      </Button>
    );
  }

  return (
    <div className="approval-reviewer-editor">
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
      <label className="tweak-row">
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
      <label className="tweak-row">
        <span>{roundText.noteLabel}</span>
        <Textarea
          aria-label={roundText.noteLabel}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="approval-slide-notes">
        <span>{roundText.slideNotesLabel}</span>
        {slideNotes.map((item, idx) => (
          <p
            key={`${String(item.slide)}:${String(idx)}`}
            className="inline-note"
          >
            {roundText.slidePrefix(item.slide)}: {item.text}
          </p>
        ))}
        <div className="tweak-actions">
          <Input
            type="number"
            min={1}
            aria-label={roundText.slideNumberLabel}
            value={slideInput}
            onChange={(event) => setSlideInput(event.target.value)}
          />
          <Input
            aria-label={roundText.slideTextLabel}
            value={slideText}
            onChange={(event) => setSlideText(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={addSlideNote}
          >
            {roundText.addSlideNote}
          </Button>
        </div>
      </div>
      <div className="tweak-actions">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? roundText.savingDecision : roundText.saveDecision}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          {wording.action.cancel}
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

  return (
    <li className="approval-triage-item">
      <div className="tweak-row">
        <span>
          {item.reviewerName} ({item.persona}) · {scopeLabel}
        </span>
        <span>{roundText.triageStatus[item.status]}</span>
      </div>
      <p className="approval-triage-text">{item.text}</p>
      {item.reply === undefined ? null : (
        <p className="inline-note">{roundText.ownerReplyLabel(item.reply)}</p>
      )}
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
      <div className="tweak-actions">
        <Button
          type="button"
          size="sm"
          disabled={busy || item.status === "incorporated"}
          onClick={() => void runTriage("incorporate")}
        >
          {roundText.incorporate}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || item.status === "dismissed"}
          onClick={() => void runTriage("dismiss")}
        >
          {roundText.dismiss}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setReplyOpen((current) => !current)}
        >
          {roundText.reply}
        </Button>
      </div>
      {replyOpen ? (
        <div className="tweak-actions">
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
  const [fault, setFault] = useState<string | null>(null);
  const canSettle =
    round.status !== "settled" &&
    round.reviewers.every((reviewer) => reviewer.state !== "sent");

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
      <header className="tweak-row">
        <strong>{roundText.roundHeading(round.packageVersion)}</strong>
        <span>{roundText.roundStatus[round.status]}</span>
      </header>
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
      <ul className="approval-reviewer-list">
        {round.reviewers.map((reviewer) => (
          <li key={reviewer.id} className="approval-reviewer-item">
            <div className="tweak-row">
              <span>
                {reviewer.name} ({reviewer.persona})
              </span>
              <span>{roundText.reviewerState[reviewer.state]}</span>
            </div>
            {reviewer.decision === undefined ? null : (
              <div className="approval-reviewer-decision">
                <p className="inline-note">
                  {roundText.outcome[reviewer.decision.outcome]}
                </p>
                {reviewer.decision.note === undefined ? null : (
                  <p className="inline-note">{reviewer.decision.note}</p>
                )}
                {reviewer.decision.slideNotes.map((slideNote, idx) => (
                  <p
                    key={`${String(slideNote.slide)}:${String(idx)}`}
                    className="inline-note"
                  >
                    {roundText.slidePrefix(slideNote.slide)}: {slideNote.text}
                  </p>
                ))}
              </div>
            )}
            {round.status === "open" ? (
              <ReviewerDecisionEditor
                projectId={projectId}
                roundId={round.roundId}
                reviewer={reviewer}
                onUpdated={onUpdated}
              />
            ) : null}
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
        <div className="tweak-actions">
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
}: {
  projectId: string;
  packageVersion: number;
  initialRounds?: readonly ApprovalRound[];
}) {
  const [rounds, setRounds] = useState<ApprovalRound[]>(
    initialRounds === undefined ? [] : [...initialRounds],
  );
  const [loading, setLoading] = useState(initialRounds === undefined);
  const [fault, setFault] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryPreset>("7d");
  const [reviewers, setReviewers] = useState<ReviewerInput[]>([
    { name: "", persona: "" },
  ]);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (initialRounds !== undefined) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await listApprovalRounds(projectId);
        if (!cancelled) setRounds(result.rounds);
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

  const handleStartRound = async () => {
    const valid = reviewers
      .map((reviewer) => ({
        name: reviewer.name.trim(),
        persona: reviewer.persona.trim(),
        ...(reviewer.email !== undefined && reviewer.email.trim() !== ""
          ? { email: reviewer.email.trim() }
          : {}),
      }))
      .filter((reviewer) => reviewer.name !== "" && reviewer.persona !== "");
    if (valid.length === 0) return;
    setStarting(true);
    setFault(null);
    try {
      const created = await startApprovalRound(projectId, {
        packageVersion,
        expiry,
        reviewers: valid,
      });
      setRounds((current) => [created, ...current]);
      setShareOpen(false);
    } catch (error) {
      setFault(humanFault(error, roundText.failed));
    } finally {
      setStarting(false);
    }
  };

  const setReviewerField = (
    index: number,
    field: "name" | "persona" | "email",
    value: string,
  ) => {
    setReviewers((current) =>
      current.map((entry, idx) =>
        idx === index ? { ...entry, [field]: value } : entry,
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
    return rounds.map((round) => (
      <RoundCard
        key={round.roundId}
        projectId={projectId}
        round={round}
        onUpdated={updateRound}
      />
    ));
  };

  return (
    <section className="approval-rounds-panel" aria-label={roundText.heading}>
      <header className="tweak-row">
        <h2>{roundText.heading}</h2>
        <div className="tweak-actions">
          <Button
            type="button"
            size="sm"
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
        <div
          className="approval-share-dialog"
          role="dialog"
          aria-label={roundText.dialogTitle}
        >
          <label className="tweak-row">
            <span>{roundText.expiryLabel}</span>
            <Select
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
            </Select>
          </label>
          {reviewers.map((reviewer, index) => (
            <div key={String(index)} className="tweak-actions">
              <Input
                aria-label={roundText.reviewerName}
                placeholder={roundText.reviewerName}
                value={reviewer.name}
                onChange={(event) =>
                  setReviewerField(index, "name", event.target.value)
                }
              />
              <Input
                aria-label={roundText.reviewerPersona}
                placeholder={roundText.reviewerPersona}
                value={reviewer.persona}
                onChange={(event) =>
                  setReviewerField(index, "persona", event.target.value)
                }
              />
              <Input
                aria-label={roundText.reviewerEmail}
                placeholder={roundText.reviewerEmail}
                value={reviewer.email === undefined ? "" : reviewer.email}
                onChange={(event) =>
                  setReviewerField(index, "email", event.target.value)
                }
              />
              {reviewers.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setReviewers((current) =>
                      current.filter((_, idx) => idx !== index),
                    )
                  }
                >
                  {roundText.removeReviewer}
                </Button>
              ) : null}
            </div>
          ))}
          <div className="tweak-actions">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setReviewers((current) => [
                  ...current,
                  { name: "", persona: "" },
                ])
              }
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
          </div>
        </div>
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
