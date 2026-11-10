/**
 * What the approval rounds do: read a package's rounds, add reviewers, record what each reviewer
 * decided, ask the coordinator for a deck tailored to them, hand out their package files, and
 * settle a round. The hub's rounds become the rows `approval-rounds.view.tsx` draws; what the
 * person types and what is in flight is kept here per round, reviewer and finding.
 */
import type { ApprovalPackageBundle } from "@corbits-builder/schemas/artifact";
import type {
  ApprovalReviewer,
  ApprovalRound,
  ReviewerOutcome,
  TriageAction,
  TriageItem,
  TriageItemStatus,
} from "@corbits-builder/schemas/approval-round";
import JSZip from "jszip";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  downloadApprovalPackageZip,
  listApprovalRounds,
  recordReviewerDecision,
  settleApprovalRound,
  triageReviewerFeedback,
} from "../../api/artifacts.ts";
import { sendMessage } from "../../api/conversation.ts";
import { wording } from "../../config.ts";
import { queryClient } from "../../queries/client.ts";
import { keys } from "../../queries/keys.ts";
import { mergeWorkspaceReviewers } from "../../workspace-approvals-setting.ts";
import {
  doesBundleMatchReviewer,
  parseApprovalPackage,
  resolveReviewerPackage,
} from "./approval-package.ts";
import type {
  ApprovalRoundsViewProps,
  Finding,
  PackageFile,
  Reviewer,
  Round,
} from "./approval-rounds.view.tsx";
import { humanFault, responseCode } from "./human-fault.ts";
import type { PassageQuote } from "./passage-note.tsx";
import type { SharePackageProps } from "./share-package.model.ts";

const roundText = wording.approvalRound;

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

function getEffectiveReviewerGoal(reviewer: ApprovalReviewer): string {
  if (reviewer.goal !== undefined && reviewer.goal.trim() !== "") {
    return reviewer.goal.trim();
  }
  return roundText.defaultGoal(reviewer.persona);
}

export type ApprovalRoundsProps = {
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
  flush?: boolean | undefined;
  shareOpen?: boolean | undefined;
  onShareOpenChange?: ((open: boolean) => void) | undefined;
};

/** State kept per id, for rows that come and go with the hub's rounds. */
type ById<T> = {
  of: (id: string) => T;
  set: (id: string, change: Partial<T>) => void;
};

/** An id nothing has been set for reads as `resting`. */
function useById<T>(resting: T): ById<T> {
  const [byId, setById] = useState<ReadonlyMap<string, T>>(() => new Map());
  return {
    of: (id) => byId.get(id) ?? resting,
    set: (id, change) =>
      setById((current) =>
        new Map(current).set(id, {
          ...(current.get(id) ?? resting),
          ...change,
        }),
      ),
  };
}

/** A hub call for one round or finding: whether it is in flight, and how it last failed. */
type Progress = { busy: boolean; fault: string | null };
const RESTING: Progress = { busy: false, fault: null };

type ReviewerFields = Reviewer["fields"];

type ReviewerState = {
  /** What was typed in the drawer, and the hub's copy of the reviewer it was typed over. */
  drafts: { over: ApprovalReviewer; fields: ReviewerFields } | null;
  downloadOpen: boolean;
  excludedPaths: ReadonlySet<string>;
  savingDetails: boolean;
  savingDecision: boolean;
  downloading: boolean;
  /** The coordinator has been asked for their deck. */
  generating: boolean;
  fault: string | null;
};
const RESTING_REVIEWER: ReviewerState = {
  drafts: null,
  downloadOpen: false,
  excludedPaths: new Set(),
  savingDetails: false,
  savingDecision: false,
  downloading: false,
  generating: false,
  fault: null,
};

function savedFields(reviewer: ApprovalReviewer): ReviewerFields {
  return {
    name: reviewer.name,
    persona: reviewer.persona,
    goal: reviewer.goal === undefined ? "" : reviewer.goal,
    outcome: reviewer.decision === undefined ? "" : reviewer.decision.outcome,
    note:
      reviewer.decision === undefined || reviewer.decision.note === undefined
        ? ""
        : reviewer.decision.note,
  };
}

// What was typed lasts until the hub's copy of the reviewer changes under it.
function currentFields(
  reviewer: ApprovalReviewer,
  drafts: ReviewerState["drafts"],
): ReviewerFields {
  if (
    drafts !== null &&
    drafts.over.name === reviewer.name &&
    drafts.over.persona === reviewer.persona &&
    drafts.over.goal === reviewer.goal &&
    drafts.over.decision === reviewer.decision
  ) {
    return drafts.fields;
  }
  return savedFields(reviewer);
}

/** What every row of the panel works with. */
type Panel = {
  projectId: string;
  bundle: ApprovalPackageBundle | null;
  bundlesByVersion: ReadonlyMap<number, ApprovalPackageBundle>;
  newlyAddedReviewerIds: ReadonlySet<string>;
  roundProgress: ById<Progress>;
  reviewerStates: ById<ReviewerState>;
  findingProgress: ById<Progress>;
  onOpenSource: ApprovalRoundsProps["onOpenSource"];
  onAddToPrompt: ApprovalRoundsProps["onAddToPrompt"];
  onDeliverMessage: ApprovalRoundsProps["onDeliverMessage"];
  updateRound: (round: ApprovalRound) => void;
};

function packageFiles(
  panel: Panel,
  bundle: ApprovalPackageBundle | null,
  excludedPaths: ReadonlySet<string>,
): PackageFile[] {
  const sources = bundle === null ? [] : bundle.manifest.sources;
  return [
    { path: "deck.pptx", label: roundText.packageItemPptx, onOpenSource: null },
    { path: "deck.pdf", label: roundText.packageItemPdf, onOpenSource: null },
    ...sources.map((source) => ({
      path: `documents/${source.kind}.md`,
      label: roundText.packageItemSource(
        wording.documentTab[source.kind] ?? source.kind,
        source.title,
        source.version,
      ),
      onOpenSource: () => panel.onOpenSource?.(source.kind, source.version),
    })),
  ].map((file) => ({ ...file, included: !excludedPaths.has(file.path) }));
}

/** Asks the coordinator for a deck tailored to a reviewer; false when the message was not delivered. */
async function requestTailoredDeck(
  panel: Panel,
  name: string,
  persona: string,
  goal: string,
): Promise<boolean> {
  const promptText = roundText.tailorPrompt(name, persona, goal);
  if (panel.onDeliverMessage !== undefined) {
    const delivered = await panel.onDeliverMessage(promptText);
    if (delivered === false) return false;
  } else {
    await sendMessage(panel.projectId, promptText);
    void queryClient.invalidateQueries({
      queryKey: keys.projectRoom.of(panel.projectId),
    });
  }
  toast.success(roundText.tailorRequested(name));
  return true;
}

function findingRow(
  panel: Panel,
  round: ApprovalRound,
  item: TriageItem,
): Finding {
  const { projectId, onAddToPrompt } = panel;
  const { busy, fault } = panel.findingProgress.of(item.itemId);
  const set = (change: Partial<Progress>) =>
    panel.findingProgress.set(item.itemId, change);

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
    panel.updateRound(optimisticRound);
    set({ busy: true, fault: null });
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
      panel.updateRound(updated);
    } catch (error) {
      const code = await responseCode(error);
      if (
        action === "incorporate" &&
        onAddToPrompt !== undefined &&
        code === "coordinator_not_running"
      ) {
        return;
      }
      panel.updateRound(round);
      set({ fault: humanFault(error, roundText.failed) });
    } finally {
      set({ busy: false });
    }
  };

  return {
    id: item.itemId,
    text: item.text,
    slide: item.slide === undefined ? null : item.slide,
    status: item.status,
    busy,
    fault,
    onIncorporate: () => void runTriage("incorporate"),
    onDismiss: () => void runTriage("dismiss"),
  };
}

function reviewerRow(
  panel: Panel,
  round: ApprovalRound,
  reviewer: ApprovalReviewer,
  reviewerIndex: number,
): Reviewer {
  const { projectId } = panel;
  const state = panel.reviewerStates.of(reviewer.id);
  const set = (change: Partial<ReviewerState>) =>
    panel.reviewerStates.set(reviewer.id, change);
  const { bundle, packageVersion } = resolveReviewerPackage({
    reviewer,
    reviewerIndex,
    round,
    bundlesByVersion: panel.bundlesByVersion,
    fallbackBundle: panel.bundle,
    newlyAddedReviewerIds: panel.newlyAddedReviewerIds,
  });
  const effectiveGoal = getEffectiveReviewerGoal(reviewer);
  const saved = savedFields(reviewer);
  const fields = currentFields(reviewer, state.drafts);

  const nameDirty =
    fields.name.trim() !== "" && fields.name.trim() !== saved.name;
  const personaDirty =
    fields.persona.trim() !== "" && fields.persona.trim() !== saved.persona;
  const goalDirty = fields.goal.trim() !== saved.goal;
  const detailsDirty = nameDirty || personaDirty || goalDirty;
  const outcomeDirty =
    fields.outcome !== "" && fields.outcome !== saved.outcome;
  const noteDirty = fields.note.trim() !== saved.note;

  const files = packageFiles(panel, bundle, state.excludedPaths);

  const openDownloadDialog = () => {
    set({ excludedPaths: new Set(), downloadOpen: true });
  };

  const togglePackageEntry = (path: string) => {
    const next = new Set(state.excludedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    set({ excludedPaths: next });
  };

  const toggleSelectAllPackageEntries = () => {
    set({
      excludedPaths: files.every((file) => file.included)
        ? new Set(files.map((file) => file.path))
        : new Set(),
    });
  };

  const saveReviewerDetails = async () => {
    const nextName = fields.name.trim();
    const nextPersona = fields.persona.trim();
    const nextGoal = fields.goal.trim();
    if (nextName === "" || nextPersona === "") return;
    set({ savingDetails: true, fault: null });
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
      panel.updateRound(updated);
      toast.success(roundText.reviewerDetailsSaved(nextName));
    } catch (error) {
      set({ fault: humanFault(error, roundText.failed) });
    } finally {
      set({ savingDetails: false });
    }
  };

  const saveInlineDecision = async (useDefaultFeedbackOutcome: boolean) => {
    let resolvedOutcome: ReviewerOutcome = "request_changes";
    if (fields.outcome !== "") {
      resolvedOutcome = fields.outcome;
    } else if (!useDefaultFeedbackOutcome && saved.outcome !== "") {
      resolvedOutcome = saved.outcome;
    }
    const trimmedNote = fields.note.trim();
    set({ savingDecision: true, fault: null });
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
      panel.updateRound(updated);
    } catch (error) {
      set({ fault: humanFault(error, roundText.failed) });
    } finally {
      set({ savingDecision: false });
    }
  };

  const downloadForReviewer = async () => {
    set({ downloading: true, fault: null });
    try {
      const rawFile = await downloadApprovalPackageZip(
        projectId,
        packageVersion,
        {
          name: fields.name.trim() || reviewer.name,
          persona: fields.persona.trim() || reviewer.persona,
          reviewerId: reviewer.id,
          roundId: round.roundId,
        },
      );
      const file = await filterZipArchiveEntries(rawFile, state.excludedPaths);
      triggerBrowserDownload(file);
      toast.success(wording.paneFile.downloaded(file.name));
      set({ downloadOpen: false });
    } catch (error) {
      set({ fault: humanFault(error, roundText.failed) });
    } finally {
      set({ downloading: false });
    }
  };

  const askCoordinatorToTailor = async () => {
    const activeName = fields.name.trim() || reviewer.name;
    const activePersona = fields.persona.trim() || reviewer.persona;
    const activeGoal = fields.goal.trim() || effectiveGoal;
    set({ generating: true, fault: null });
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
        panel.updateRound(updated);
      }
      const delivered = await requestTailoredDeck(
        panel,
        activeName,
        activePersona,
        activeGoal,
      );
      if (!delivered) set({ generating: false });
    } catch (error) {
      set({ generating: false, fault: humanFault(error, roundText.failed) });
    }
  };

  return {
    id: reviewer.id,
    name: reviewer.name,
    persona: reviewer.persona,
    goal: effectiveGoal,
    status:
      reviewer.decision === undefined
        ? reviewer.state
        : reviewer.decision.outcome,
    justAdded: panel.newlyAddedReviewerIds.has(reviewer.id),
    fields,
    unsaved: {
      name: nameDirty,
      persona: personaDirty,
      goal: goalDirty,
      outcome: outcomeDirty,
      note: noteDirty,
    },
    onEdit: (edited) =>
      set({ drafts: { over: reviewer, fields: { ...fields, ...edited } } }),
    savingDetails: state.savingDetails,
    onSaveDetails: () => void saveReviewerDetails(),
    savingDecision: state.savingDecision,
    onSaveOutcome: () => void saveInlineDecision(false),
    onSaveNote: () => void saveInlineDecision(true),
    fault: state.fault,
    deck: bundle === null ? null : bundle.deck,
    generatingDeck: bundle === null && state.generating,
    onGenerateDeck: () => void askCoordinatorToTailor(),
    download: {
      open: state.downloadOpen,
      files,
      downloading: state.downloading,
      onOpen: openDownloadDialog,
      onOpenChange: (open) => set({ downloadOpen: open }),
      onToggleFile: togglePackageEntry,
      onToggleAllFiles: toggleSelectAllPackageEntries,
      onDownload: () => void downloadForReviewer(),
    },
    findings:
      reviewer.decision === undefined
        ? []
        : round.triage
            .filter((item) => item.reviewerId === reviewer.id)
            .map((item) => findingRow(panel, round, item)),
  };
}

function roundRow(panel: Panel, round: ApprovalRound): Round {
  const { busy, fault } = panel.roundProgress.of(round.roundId);
  const set = (change: Partial<Progress>) =>
    panel.roundProgress.set(round.roundId, change);

  const settle = async () => {
    set({ busy: true, fault: null });
    try {
      const updated = await settleApprovalRound(panel.projectId, round.roundId);
      panel.updateRound(updated);
    } catch (error) {
      set({ fault: humanFault(error, roundText.failed) });
    } finally {
      set({ busy: false });
    }
  };

  return {
    id: round.roundId,
    packageVersion: round.packageVersion,
    status: round.status,
    canSettle:
      round.status !== "settled" &&
      round.reviewers.every((reviewer) => reviewer.state !== "sent"),
    settling: busy,
    fault,
    onSettle: () => void settle(),
    reviewers: round.reviewers.map((reviewer, reviewerIndex) =>
      reviewerRow(panel, round, reviewer, reviewerIndex),
    ),
  };
}

export function useApprovalRounds({
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
  flush = false,
  shareOpen: controlledShareOpen,
  onShareOpenChange,
}: ApprovalRoundsProps): {
  view: Omit<ApprovalRoundsViewProps, "addReviewerForm">;
  /** The form the page puts in the view's add-reviewer dialog. */
  addReviewer: SharePackageProps;
} {
  const bundle =
    packageContent === undefined ? null : parseApprovalPackage(packageContent);
  const [fetchedBundles, setFetchedBundles] = useState<
    ReadonlyMap<number, ApprovalPackageBundle>
  >(() => new Map<number, ApprovalPackageBundle>());
  const [newlyAddedReviewerIds, setNewlyAddedReviewerIds] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [rounds, setRounds] = useState<ApprovalRound[]>(
    initialRounds === undefined ? [] : [...initialRounds],
  );
  const [loading, setLoading] = useState(initialRounds === undefined);
  const [fault, setFault] = useState<string | null>(null);
  const [internalShareOpen, setInternalShareOpen] = useState(false);
  const roundProgress = useById(RESTING);
  const reviewerStates = useById(RESTING_REVIEWER);
  const findingProgress = useById(RESTING);

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

  const shareOpen = controlledShareOpen ?? internalShareOpen;
  const setShareOpen = (open: boolean) => {
    setInternalShareOpen(open);
    onShareOpenChange?.(open);
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

  const panel: Panel = {
    projectId,
    bundle,
    bundlesByVersion,
    newlyAddedReviewerIds,
    roundProgress,
    reviewerStates,
    findingProgress,
    onOpenSource,
    onAddToPrompt,
    onDeliverMessage,
    updateRound,
  };

  const tailorForAddedReviewer = async (added: ApprovalReviewer) => {
    reviewerStates.set(added.id, { generating: true });
    try {
      const delivered = await requestTailoredDeck(
        panel,
        added.name,
        added.persona,
        getEffectiveReviewerGoal(added),
      );
      if (!delivered) reviewerStates.set(added.id, { generating: false });
    } catch (error) {
      reviewerStates.set(added.id, { generating: false });
      setFault(humanFault(error, roundText.failed));
    }
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
      for (const rev of addedReviewers) {
        const hasMatch = [...bundlesByVersion.values()].some((candidate) =>
          doesBundleMatchReviewer(candidate, rev),
        );
        if (!hasMatch) void tailorForAddedReviewer(rev);
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

  return {
    view: {
      flush,
      loading,
      fault,
      packageDeck: bundle === null ? null : bundle.deck,
      rounds: rounds.map((round) => roundRow(panel, round)),
      addingReviewer: shareOpen,
      onAddingReviewerChange: setShareOpen,
    },
    addReviewer: {
      projectId,
      packageVersion,
      onCreated: handleRoundCreated,
      onCancel: () => setShareOpen(false),
      onFault: setFault,
    },
  };
}
