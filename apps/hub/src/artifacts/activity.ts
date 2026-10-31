import { type } from "arktype";
import type { SidecarEventEmitter } from "@intx/hub-sessions";
import { parseAddress } from "@intx/types/agent-address";
import { parseInferenceEvent } from "@intx/types/runtime";
import type { ActivityTool } from "@corbits-builder/schemas/activity";
import type { RunProgress } from "@corbits-builder/schemas/artifact";

// The argument that names what a call touches, in the order a tool is likely to carry it.
const SUBJECT_KEYS = [
  "path",
  "file",
  "name",
  "command",
  "pattern",
  "query",
  "kind",
  "packages",
];
// Progress names a call by what it targets, never by text the model wrote into it.
const TARGET_KEYS = ["path", "file", "name", "kind", "packages"];
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const MAX_TARGET = 60;
const RECENT_PROGRESS = 5;
const PROGRESS_FILES = 8;
const MAX_SUBJECT = 120;
const MAX_SAID = 280;
const RECENT_TOOLS = 3;
const MAX_RUNS = 512;

type RunActivity = {
  tools: (ActivityTool & { callId: string })[];
  recent: { label: string; at: string }[];
  writing: Map<string, string>;
  // Every path a successful write landed on, most recent last.
  files: string[];
  turns: number;
  lastActivityAt?: string;
  said?: string;
  // When the run last started or finished a turn: the start of its working or waiting.
  since?: string;
  working: boolean;
};

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
};

function subjectOf(
  args: Record<string, unknown>,
  keys = SUBJECT_KEYS,
  max = MAX_SUBJECT,
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    const text = Array.isArray(value)
      ? value.filter((item) => typeof item === "string").join(", ")
      : value;
    if (typeof text === "string" && text.trim() !== "") return clip(text, max);
  }
  return undefined;
}

// A step address is the run id with the step id appended, `<runId>-<stepId>@<domain>`.
const ownsAddress = (runId: string, local: string) =>
  local === runId || local.startsWith(runId + "-");

/**
 * The latest tool calls and assistant text of every run, from the inference events sidecars
 * forward to the hub. These events are ephemeral, so what the hub saw before a restart is gone
 * and that run reads as having shown nothing yet.
 */
export function createAgentActivity(events: Pick<SidecarEventEmitter, "on">) {
  const runs = new Map<string, RunActivity>();

  const entry = (local: string) => {
    let found = runs.get(local);
    if (found) runs.delete(local);
    else
      found = {
        tools: [],
        recent: [],
        writing: new Map(),
        files: [],
        turns: 0,
        working: false,
      };
    runs.set(local, found);
    if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value ?? local);
    return found;
  };

  const dispose = events.on("agent.event", ({ agentAddress, event: raw }) => {
    const local = parseAddress(agentAddress)?.localPart;
    if (!local) return;
    const event = parseInferenceEvent(raw);
    if (event instanceof type.errors) return;
    const now = new Date().toISOString();
    if (event.type.startsWith("tool.") || event.type.startsWith("message.run."))
      entry(local).lastActivityAt = now;
    switch (event.type) {
      case "message.run.started": {
        const run = entry(local);
        run.working = true;
        run.turns += 1;
        run.since = new Date(event.data.receivedAt).toISOString();
        run.tools = [];
        delete run.said;
        return;
      }
      case "message.run.ended": {
        const run = entry(local);
        run.working = false;
        run.since = now;
        return;
      }
      case "tool.start": {
        const run = entry(local);
        // A turn whose start the hub missed, as after its own restart, dates from this call.
        if (!run.working) run.since = now;
        run.working = true;
        const subject = subjectOf(event.data.call.arguments);
        run.tools = [
          ...run.tools,
          {
            callId: event.data.call.id,
            name: event.data.call.name,
            ...(subject ? { subject } : {}),
            running: true,
            at: now,
          },
        ].slice(-RECENT_TOOLS);
        const { id, name, arguments: args } = event.data.call;
        const target = subjectOf(args, TARGET_KEYS, MAX_TARGET);
        run.recent = [
          ...run.recent,
          { label: target ? name + " " + target : name, at: now },
        ].slice(-RECENT_PROGRESS);
        if (WRITE_TOOLS.has(name) && typeof args["path"] === "string")
          run.writing.set(id, args["path"]);
        return;
      }
      case "tool.done": {
        const run = entry(local);
        const { callId, isError } = event.data.result;
        const call = run.tools.find((tool) => tool.callId === callId);
        if (call) call.running = false;
        const path = run.writing.get(callId);
        run.writing.delete(callId);
        if (path !== undefined && isError !== true)
          run.files = [...run.files.filter((file) => file !== path), path];
        return;
      }
      case "inference.done": {
        const text = event.data.turn.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join(" ");
        if (text.trim() !== "") entry(local).said = clip(text, MAX_SAID);
        return;
      }
    }
  });

  return {
    dispose,
    /**
     * What the run's events last showed, merged across its step addresses. A run with no turn
     * in progress is parked waiting for mail; since dates its latest turn start or end.
     */
    of(runId: string) {
      const owned = [...runs]
        .filter(([local]) => ownsAddress(runId, local))
        .map(([, run]) => run);
      const working = owned.some((run) => run.working);
      let since: string | undefined;
      let said: string | undefined;
      const tools: ActivityTool[] = [];
      for (const run of owned) {
        if (
          run.working === working &&
          run.since &&
          (!since || run.since > since)
        )
          since = run.since;
        said = run.said ?? said;
        for (const { name, subject, running, at } of run.tools)
          tools.push({ name, ...(subject ? { subject } : {}), running, at });
      }
      tools.sort((left, right) => left.at.localeCompare(right.at));
      return {
        working,
        ...(since ? { since } : {}),
        ...(said ? { said } : {}),
        tools: tools.slice(-RECENT_TOOLS),
      };
    },
    /** The run's progress across its step addresses, once the hub has seen any of its events. */
    progress(runId: string): RunProgress | undefined {
      const owned = [...runs]
        .filter(([local]) => ownsAddress(runId, local))
        .map(([, run]) => run);
      const lastActivityAt = owned
        .flatMap((run) => (run.lastActivityAt ? [run.lastActivityAt] : []))
        .sort()
        .at(-1);
      if (!lastActivityAt) return undefined;
      const files = [...new Set(owned.flatMap((run) => run.files))];
      return {
        turns: owned.reduce((sum, run) => sum + run.turns, 0),
        recent: owned
          .flatMap((run) => run.recent)
          .sort((left, right) => left.at.localeCompare(right.at))
          .slice(-RECENT_PROGRESS)
          .map((call) => call.label),
        filesWritten: files.length,
        files: files
          .slice(-PROGRESS_FILES)
          .map((file) => clip(file, MAX_TARGET)),
        lastActivityAt,
      };
    },
  };
}

export type AgentActivityTracker = ReturnType<typeof createAgentActivity>;
