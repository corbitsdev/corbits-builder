import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { workflowRun } from "@intx/db/schema";
import type { ProjectExport } from "@corbits-builder/schemas/project";
import { startTestHub, type TestHubHandle } from "../e2e/support/hub.ts";
import {
  NonEmptyString,
  STAGE_DEADLINE_MS,
} from "../e2e/support/pipeline-driver.ts";
import {
  formatOpenAISseResponse,
  startRecordedModelServer,
  writeScenarioFixture,
  type ExchangeExpectation,
  type RecordedModelServer,
} from "../e2e/support/recorded-model.ts";
import {
  baselineOf,
  Cases,
  observe,
  readStored,
  recordCase,
  type CaseModel,
  type CaseRecord,
  type HintSetting,
  type Observation,
  type Remark,
} from "./recorder.ts";
import { startingProject } from "../scenarios/runner.ts";

const RESULTS =
  process.env["BASELINE_RESULTS"] ??
  join(
    "/private/tmp/claude-501/-Users-thegreataxios-abklabs-corbits-builder-dynamic-coordinator/90d7a05a-0c61-4904-bc1a-99c3cdc2bd75/scratchpad/baseline",
    `coordinator-moves-${new Date().toISOString().replaceAll(":", "-")}.jsonl`,
  );
const CASE_DEADLINE_MS = Number(
  process.env["BASELINE_CASE_DEADLINE_MS"] ?? STAGE_DEADLINE_MS,
);
const POLL_MS = 1_000;
const SCRIPTED = "scripted";
const IMPORT_LEAD = "I just imported this project from a file.";
const SCRIPTED_TOOLS = ["question", "discover", "execute", "read_artifact"];
const largerText = {
  instruction: "Make the body text larger. Change nothing else.",
};

type Case = Readonly<{
  remark: Remark;
  model: CaseModel;
  hint: HintSetting;
  repeat: number;
}>;

// One scripted model turn, and whether the hub refuses the call it makes.
type ScriptedTurn = Readonly<{
  reply: Parameters<typeof formatOpenAISseResponse>[0];
  refused?: boolean;
}>;

function call(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ScriptedTurn["reply"] {
  return { toolCalls: [{ id, name, arguments: args }] };
}

const askPrompt = {
  questions: [
    {
      question: "What would you like to change about how it looks?",
      header: "Look",
      options: [
        { label: "Fonts", description: "" },
        { label: "Colours", description: "" },
      ],
    },
  ],
};

// What the scripted coordinator does, case by case in turn, and what the recorder must make of it.
const SCRIPTS: readonly Readonly<{
  turns: readonly ScriptedTurn[];
  moves: readonly string[];
  screen: Readonly<{ firstValid: boolean; retryValid: boolean | null }> | null;
  readBeforeActing: boolean;
}>[] = [
  {
    turns: [
      { reply: call("discover", "discover", { query: "font" }) },
      { reply: { text: "I can show you a font picker." } },
    ],
    moves: ["discover", "reply"],
    screen: null,
    readBeforeActing: false,
  },
  {
    turns: [
      {
        reply: call("open", "question", {
          plugin: "designer",
          action: "pick-fonts",
          input: {},
        }),
      },
    ],
    moves: ["open:designer.pick-fonts"],
    screen: { firstValid: true, retryValid: null },
    readBeforeActing: false,
  },
  {
    turns: [
      {
        reply: call("open_bad", "question", {
          plugin: "designer",
          action: "pick-fonts",
          input: { list: "fancy" },
        }),
        refused: true,
      },
      {
        reply: call("open_again", "question", {
          plugin: "designer",
          action: "pick-fonts",
          input: {},
        }),
      },
    ],
    moves: ["open:designer.pick-fonts", "open:designer.pick-fonts"],
    screen: { firstValid: false, retryValid: true },
    readBeforeActing: false,
  },
  {
    turns: [{ reply: call("ask", "question", askPrompt) }],
    moves: ["ask"],
    screen: null,
    readBeforeActing: false,
  },
  {
    turns: [
      {
        reply: call("instruct", "execute", {
          plugin: "coder",
          action: "change",
          input: largerText,
        }),
      },
    ],
    moves: ["execute:coder.change"],
    screen: null,
    readBeforeActing: false,
  },
  {
    turns: [{ reply: { text: "Thanks, I have noted that." } }],
    moves: ["reply"],
    screen: null,
    readBeforeActing: false,
  },
  {
    turns: [
      { reply: call("read", "read_artifact", { kind: "problem_brief" }) },
      { reply: call("read_ask", "question", askPrompt) },
    ],
    moves: ["read", "ask"],
    screen: null,
    readBeforeActing: true,
  },
];

// The plugins the hub's note names for each remark (apps/hub/src/plugins/tools.ts withPluginHint).
const HINTED: Readonly<
  Record<HintSetting, Readonly<Record<string, string[]>>>
> = {
  off: {},
  triggers: {
    "the font is ugly": ["designer pick-fonts"],
    "the font is too small": ["designer pick-fonts"],
    "change the font to Inter": ["designer pick-fonts"],
  },
  fields: {
    "the font is ugly": ["designer pick-fonts"],
    "the font is too small": ["designer pick-fonts"],
    "I don't know if I love how this looks": ["designer review"],
    "the title looks weird": ["designer review"],
  },
};

function listed(name: string): string[] | undefined {
  return process.env[name]
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function selectCases(cases: Cases): Case[] {
  const modelIds = listed("BASELINE_MODELS") ?? [SCRIPTED];
  const hints = listed("BASELINE_HINTS") ?? cases.hints;
  const remarkFilter = process.env["BASELINE_REMARK"]?.toLowerCase();
  const repeats = Number(process.env["BASELINE_REPEATS"] ?? cases.repeats);
  const maxCases = Number(process.env["BASELINE_MAX_CASES"] ?? Infinity);
  const models = modelIds.map((id) => {
    const model = cases.models.find((candidate) => candidate.id === id);
    if (!model) throw new Error(`BASELINE_MODELS names unknown model ${id}`);
    return model;
  });
  const runnable = models.filter((model) => {
    if (!model.key || process.env[model.key]) return true;
    console.log(`Skipping ${model.id}: ${model.key} is not set.`);
    return false;
  });
  const selected: Case[] = [];
  for (const hint of cases.hints.filter((setting) => hints.includes(setting)))
    for (const model of runnable)
      for (const remark of cases.remarks.filter(
        (candidate) =>
          !remarkFilter || candidate.text.toLowerCase().includes(remarkFilter),
      ))
        for (let repeat = 1; repeat <= repeats; repeat++)
          selected.push({ remark, model, hint, repeat });
  return selected.slice(0, maxCases);
}

function scriptFor(index: number) {
  const script = SCRIPTS[index % SCRIPTS.length];
  if (!script) throw new Error(`No script for case ${index}`);
  return script;
}

// The scripted coordinator's turns for one case: it acknowledges the import, then answers the
// remark with its script, each later turn expecting the hub's result for the call before it.
function scriptedExchanges(remark: string, turns: readonly ScriptedTurn[]) {
  const exchanges: { sse: string; expect: ExchangeExpectation }[] = [
    {
      sse: formatOpenAISseResponse({
        text: "The weather app is imported and built.",
      }),
      expect: {
        lastMessageRole: "user",
        userTextContains: IMPORT_LEAD,
        requiredTools: SCRIPTED_TOOLS,
        toolResults: [],
      },
    },
  ];
  let previous: ScriptedTurn | undefined;
  for (const turn of turns) {
    const previousCall = previous?.reply.toolCalls?.[0];
    exchanges.push({
      sse: formatOpenAISseResponse(turn.reply),
      expect: previousCall
        ? {
            lastMessageRole: "tool",
            requiredTools: SCRIPTED_TOOLS,
            toolResults: [
              {
                callId: previousCall.id,
                toolName: previousCall.name,
                isError: previous?.refused === true,
              },
            ],
          }
        : {
            lastMessageRole: "user",
            userTextContains: remark,
            requiredTools: SCRIPTED_TOOLS,
            toolResults: [],
          },
    });
    previous = turn;
  }
  return exchanges;
}

async function until<T>(
  description: string,
  deadlineMs: number,
  check: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = performance.now() + deadlineMs;
  while (performance.now() < deadline) {
    const found = await check();
    if (found !== undefined) return found;
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function stopReason(observation: Observation): string | undefined {
  if (observation.parked) return "question";
  if (observation.pendingApproval) return "approval";
  if (observation.moves.length >= 2) return "two_moves";
  if (observation.textTurns.length > 0) return "text";
  return undefined;
}

async function useProfile(hub: TestHubHandle, profile: string): Promise<void> {
  const { fields } = await hub.client.personalSettings(hub.workspaceTenantId);
  const custom = fields.models?.value?.custom;
  if (!fields.models || !custom) throw new Error("Personal models are unset");
  const receipt = await hub.client.savePersonalSettings(hub.workspaceTenantId, {
    command: "save_settings",
    idempotencyKey: crypto.randomUUID(),
    fields: {
      models: {
        baseVersion: fields.models.version,
        value: { profile, custom },
      },
    },
  });
  expect(receipt.conflicts).toEqual([]);
}

async function runCase(
  hub: TestHubHandle,
  recordedModel: RecordedModelServer,
  exported: ProjectExport,
  kase: Case,
): Promise<CaseRecord> {
  const { client, workspaceTenantId } = hub;
  const started = performance.now();
  await useProfile(hub, kase.model.profile);
  const { projectId } = await client.importProject(workspaceTenantId, exported);
  const tenantId = (await client.project(workspaceTenantId, projectId))
    .tenantId;
  const failed = () => {
    const failure = recordedModel.firstFailure();
    if (failure) throw failure;
  };
  try {
    await until(
      "the coordinator to acknowledge the import",
      CASE_DEADLINE_MS,
      async () => {
        failed();
        const { turns } = await client.conversationEvents(tenantId, projectId);
        return turns?.some((turn) => turn.role === "assistant") || undefined;
      },
    );
    const runId = NonEmptyString.assert(
      (await client.project(workspaceTenantId, projectId)).coordinatorRunId,
    );
    const settled = await readStored(hub, runId, 10);
    if (settled instanceof Error) throw settled;
    const since = baselineOf(
      settled,
      await client.conversationEvents(tenantId, projectId),
    );
    const [registry, projectSettings] = await Promise.all([
      client.preferenceRegistry(workspaceTenantId),
      client.settings(tenantId, projectId),
    ]);
    const chosen = projectSettings.fields.preferences?.value;
    const settings = {
      preferences: Object.fromEntries(
        registry.preferences.map((entry) => [
          entry.id,
          chosen?.[entry.id] ?? entry.default,
        ]),
      ),
      models: projectSettings.fields.models?.value ?? null,
    };
    const imported = performance.now();

    await client.sendMessage(tenantId, runId, { content: kase.remark.text });
    const deadline = performance.now() + CASE_DEADLINE_MS;
    let stoppedBy: string | undefined;
    while (!stoppedBy && performance.now() < deadline) {
      failed();
      await Bun.sleep(POLL_MS);
      stoppedBy = stopReason(
        await observe(
          client,
          { tenantId, projectId },
          await readStored(hub, runId, 1),
          since,
        ),
      );
    }
    const stopped = performance.now();
    const observation = await observe(
      client,
      { tenantId, projectId },
      await readStored(hub, runId, 5),
      since,
    );
    return recordCase({
      remark: kase.remark,
      model: kase.model,
      hint: kase.hint,
      repeat: kase.repeat,
      projectId,
      runId,
      settings,
      observation,
      since,
      stoppedBy: stoppedBy ?? "deadline",
      timings: {
        importMs: Math.round(imported - started),
        remarkToStopMs: Math.round(stopped - imported),
      },
    });
  } finally {
    await client.archiveProject(tenantId, projectId);
    // Archive cancels the coordinator and its specialists; the next case starts only once they end.
    await until(
      "the archived case's runs to stop",
      CASE_DEADLINE_MS,
      async () => {
        const live = await hub.db
          .select({ id: workflowRun.id })
          .from(workflowRun)
          .where(
            and(
              eq(workflowRun.tenantId, tenantId),
              inArray(workflowRun.status, ["deployed", "running"]),
            ),
          );
        return live.length === 0 || undefined;
      },
    );
  }
}

function printTable(records: readonly CaseRecord[]): void {
  const rows: Record<string, Record<string, string>> = {};
  for (const record of records) {
    const row = (rows[record.remark] ??= {});
    const column = `${record.model} ${record.hint}`;
    const cell = `${record.moves[0]?.move ?? "none"} ${record.verdict}`;
    row[column] = row[column] ? `${row[column]} | ${cell}` : cell;
  }
  console.table(rows);
}

test("records the coordinator's first moves after a person's remark about a built app", async () => {
  const cases = Cases.assert(
    await Bun.file(join(import.meta.dir, "cases.json")).json(),
  );
  const selected = selectCases(cases);
  if (selected.length === 0) throw new Error("No baseline cases selected");
  await mkdir(dirname(RESULTS), { recursive: true });
  console.log(`Baseline: ${selected.length} cases, results in ${RESULTS}`);

  const exported = await startingProject("weather-app");

  const records: CaseRecord[] = [];
  for (const hint of cases.hints) {
    const hinted = selected.filter((kase) => kase.hint === hint);
    if (hinted.length === 0) continue;
    const scripted = hinted.filter((kase) => kase.model.id === SCRIPTED);
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "builder-baseline-fixture-"),
    );
    let recordedModel: RecordedModelServer | undefined;
    let hub: TestHubHandle | undefined;
    try {
      await writeScenarioFixture(
        fixtureDir,
        { scenario: `baseline-${hint}`, recordedFromCommit: "scripted" },
        scripted.map((kase, index) => ({
          runKey: `coordinator-${index + 1}`,
          role: "coordinator",
          stage: "baseline",
          sourceRunId: `run_baseline_${index + 1}`,
          exchanges: scriptedExchanges(
            kase.remark.text,
            scriptFor(index).turns,
          ),
        })),
      );
      recordedModel = await startRecordedModelServer(fixtureDir);
      const providerKeys: Record<string, string> = {};
      for (const { model } of hinted) {
        const value = model.key && process.env[model.key];
        if (model.key && value) providerKeys[model.key] = value;
      }
      hub = await startTestHub(recordedModel, {
        pluginHint: hint,
        providerKeys,
      });

      let scriptedIndex = 0;
      for (const kase of hinted) {
        const record = await runCase(hub, recordedModel, exported, kase);
        records.push(record);
        await appendFile(RESULTS, `${JSON.stringify(record)}\n`);
        console.log(
          `${record.model} ${record.hint} #${record.repeat} "${record.remark}": ${record.moves.map((move) => move.move).join(", ") || "none"} (${record.verdict}, stopped by ${record.stoppedBy})`,
        );
        if (kase.model.id !== SCRIPTED) continue;
        // The self-proof: the recorder must see exactly what the script did.
        const script = scriptFor(scriptedIndex++);
        expect(record.moves.map((move) => move.move)).toEqual([
          ...script.moves,
        ]);
        expect(record.screen).toEqual(script.screen);
        expect(record.readBeforeActing).toBe(script.readBeforeActing);
        expect(record.storedConversation).toBe("read");
        const plugins = HINTED[hint][record.remark] ?? [];
        expect(record.hintNote).toEqual({
          reached: plugins.length > 0,
          plugins,
        });
      }
      recordedModel.assertClean();
    } finally {
      if (hub) await hub.close();
      if (recordedModel) await recordedModel.stop();
      await rm(fixtureDir, { recursive: true, force: true });
    }
  }
  printTable(records);
});
