/**
 * Workspace-level stakeholder approval settings and saved workspace reviewers,
 * chosen in Settings or while sharing a package and synced across tabs.
 */
import { useSyncExternalStore } from "react";
import type { WorkspaceReviewer } from "@corbits-builder/client";
import { wording } from "./config.ts";
import {
  readStoredPreference,
  writeStoredPreference,
} from "./stored-preference.ts";

const APPROVALS_ENABLED_KEY = "builder-workspace-approvals-enabled";
const WORKSPACE_REVIEWERS_KEY = "builder-workspace-reviewers";
const CUSTOM_PERSONAS_KEY = "builder-workspace-custom-personas";

export type OnOff = "on" | "off";

const parseDefaultOff = (raw: string | null): OnOff =>
  raw === "on" ? "on" : "off";

const readApprovalsEnabled = (): OnOff =>
  parseDefaultOff(readStoredPreference(APPROVALS_ENABLED_KEY));

export function useWorkspaceApprovalsEnabled(): OnOff {
  return useSyncExternalStore(
    subscribeReviewers,
    readApprovalsEnabled,
    readApprovalsEnabled,
  );
}

export function writeWorkspaceApprovalsEnabled(choice: OnOff): void {
  writeStoredPreference(APPROVALS_ENABLED_KEY, choice);
  notifyReviewers();
}

/** Seeded workspace reviewers available out of the box across all projects in the workspace. */
export const DEFAULT_WORKSPACE_REVIEWERS: readonly WorkspaceReviewer[] = [
  {
    id: "ws-rev-dana-chen",
    name: "Dana Chen",
    persona: "CEO",
    email: "dana.chen@example.com",
    goal: "Approve Aurora Weather Studio scope, timeline, and Q3 budget to begin the Coder phase",
  },
  {
    id: "ws-rev-marcus-vance",
    name: "Marcus Vance",
    persona: "CTO",
    email: "marcus.vance@example.com",
    goal: "Sign off on radar tile payload budget, latency SLAs, and offline caching architecture",
  },
  {
    id: "ws-rev-priya-patel",
    name: "Priya Patel",
    persona: "VP Product",
    email: "priya.patel@example.com",
    goal: "Confirm user journey, severe alert triage flow, and accessibility targets",
  },
];

let cachedReviewersRaw: string | null = null;
let cachedReviewersList: readonly WorkspaceReviewer[] =
  DEFAULT_WORKSPACE_REVIEWERS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseReviewerEntry(entry: unknown): WorkspaceReviewer | null {
  if (!isRecord(entry)) return null;
  if (typeof entry.id !== "string") return null;
  if (typeof entry.name !== "string") return null;
  if (typeof entry.persona !== "string") return null;
  const emailValue =
    typeof entry.email === "string" && entry.email.trim().length > 0
      ? entry.email.trim()
      : undefined;
  const goalValue =
    typeof entry.goal === "string" && entry.goal.trim().length > 0
      ? entry.goal.trim()
      : undefined;
  return {
    id: entry.id,
    name: entry.name,
    persona: entry.persona,
    ...(emailValue === undefined ? {} : { email: emailValue }),
    ...(goalValue === undefined ? {} : { goal: goalValue }),
  };
}

function parseReviewers(raw: string | null): readonly WorkspaceReviewer[] {
  if (raw === cachedReviewersRaw) return cachedReviewersList;
  cachedReviewersRaw = raw;
  if (raw === null) {
    cachedReviewersList = DEFAULT_WORKSPACE_REVIEWERS;
    return cachedReviewersList;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedReviewersList = DEFAULT_WORKSPACE_REVIEWERS;
      return cachedReviewersList;
    }
    const valid: WorkspaceReviewer[] = [];
    for (const item of parsed) {
      const reviewer = parseReviewerEntry(item);
      if (reviewer !== null) {
        valid.push(reviewer);
      }
    }
    cachedReviewersList = valid;
    return cachedReviewersList;
  } catch (error) {
    console.warn("Invalid stored workspace reviewers JSON.", error);
    cachedReviewersList = DEFAULT_WORKSPACE_REVIEWERS;
    return cachedReviewersList;
  }
}

const reviewersListeners = new Set<() => void>();

function subscribeReviewers(listener: () => void): () => void {
  reviewersListeners.add(listener);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", listener);
  }
  return () => {
    reviewersListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", listener);
    }
  };
}

function notifyReviewers(): void {
  for (const listener of reviewersListeners) listener();
}

export function readWorkspaceReviewers(): readonly WorkspaceReviewer[] {
  return parseReviewers(readStoredPreference(WORKSPACE_REVIEWERS_KEY));
}

export function writeWorkspaceReviewers(
  reviewers: readonly WorkspaceReviewer[],
): void {
  writeStoredPreference(WORKSPACE_REVIEWERS_KEY, JSON.stringify(reviewers));
  notifyReviewers();
}

export function addWorkspaceReviewer(input: {
  name: string;
  persona: string;
  email?: string;
  goal?: string;
}): WorkspaceReviewer {
  const current = [...readWorkspaceReviewers()];
  const trimmedName = input.name.trim();
  const trimmedPersona = input.persona.trim();
  const trimmedEmail =
    input.email !== undefined && input.email.trim().length > 0
      ? input.email.trim()
      : undefined;
  const trimmedGoal =
    input.goal !== undefined && input.goal.trim().length > 0
      ? input.goal.trim()
      : undefined;
  const slug = trimmedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const id = `ws-rev-${slug.length > 0 ? slug : "reviewer"}`;
  const nextEntry: WorkspaceReviewer = {
    id,
    name: trimmedName,
    persona: trimmedPersona,
    ...(trimmedEmail === undefined ? {} : { email: trimmedEmail }),
    ...(trimmedGoal === undefined ? {} : { goal: trimmedGoal }),
  };
  const existingIndex = current.findIndex(
    (entry) => entry.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  if (existingIndex >= 0) {
    current[existingIndex] = nextEntry;
  } else {
    current.push(nextEntry);
  }
  writeWorkspaceReviewers(current);
  return nextEntry;
}

export function removeWorkspaceReviewer(id: string): void {
  const current = readWorkspaceReviewers();
  writeWorkspaceReviewers(current.filter((entry) => entry.id !== id));
}

export function mergeWorkspaceReviewers(
  incoming: readonly WorkspaceReviewer[],
): void {
  if (incoming.length === 0) return;
  const raw = readStoredPreference(WORKSPACE_REVIEWERS_KEY);
  if (raw === null) {
    writeWorkspaceReviewers(incoming);
    return;
  }
  const current = [...readWorkspaceReviewers()];
  let changed = false;
  for (const item of incoming) {
    const exists = current.some(
      (entry) =>
        entry.id === item.id ||
        entry.name.toLowerCase() === item.name.toLowerCase(),
    );
    if (!exists) {
      current.push(item);
      changed = true;
    }
  }
  if (changed) {
    writeWorkspaceReviewers(current);
  }
}

export function useWorkspaceReviewers(): readonly WorkspaceReviewer[] {
  return useSyncExternalStore(
    subscribeReviewers,
    readWorkspaceReviewers,
    () => DEFAULT_WORKSPACE_REVIEWERS,
  );
}

let cachedPersonasRaw: string | null = null;
let cachedPersonasList: readonly string[] = [];

function parseCustomPersonas(raw: string | null): readonly string[] {
  if (raw === cachedPersonasRaw) return cachedPersonasList;
  cachedPersonasRaw = raw;
  if (raw === null) {
    cachedPersonasList = [];
    return cachedPersonasList;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedPersonasList = [];
      return cachedPersonasList;
    }
    cachedPersonasList = parsed.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
    return cachedPersonasList;
  } catch (error) {
    console.warn("Invalid stored custom personas JSON.", error);
    cachedPersonasList = [];
    return cachedPersonasList;
  }
}

export function readCustomReviewerPersonas(): readonly string[] {
  return parseCustomPersonas(readStoredPreference(CUSTOM_PERSONAS_KEY));
}

export function addCustomReviewerPersona(persona: string): void {
  const trimmed = persona.trim();
  if (trimmed.length === 0) return;
  const builtIn = wording.approvalRound.reviewerPersonas;
  if (builtIn.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
    return;
  }
  const current = [...readCustomReviewerPersonas()];
  if (current.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
    return;
  }
  current.push(trimmed);
  writeStoredPreference(CUSTOM_PERSONAS_KEY, JSON.stringify(current));
  notifyReviewers();
}

export function useCustomReviewerPersonas(): readonly string[] {
  return useSyncExternalStore(
    subscribeReviewers,
    readCustomReviewerPersonas,
    () => cachedPersonasList,
  );
}

export function allReviewerPersonas(
  custom: readonly string[],
  reviewers: readonly WorkspaceReviewer[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const pushUnique = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };
  for (const preset of wording.approvalRound.reviewerPersonas) {
    pushUnique(preset);
  }
  for (const reviewer of reviewers) {
    pushUnique(reviewer.persona);
  }
  for (const item of custom) {
    pushUnique(item);
  }
  return result;
}
