import { type SandboxToolchains } from "@corbits-builder/schemas/installed-workflows";
import { type } from "arktype";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { DB } from "@intx/db";
import { workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import type { TenantEnv } from "@intx/hub-api";
import { getLogger } from "@intx/log";
import type {
  CheckOutcome,
  CommandRun,
  CommandSteps,
} from "@corbits-builder/plugin";
import {
  isCheckAction,
  type Catalog,
  type CheckAction,
} from "@corbits-builder/plugin-host/catalog";
import {
  keepChecking,
  NO_APP,
  runCheck,
  type Saved,
} from "@corbits-builder/plugin-host/checks";
import { makersIn } from "@corbits-builder/plugin-host/coordinator";
import {
  approvalFact,
  resolveFacts,
  unmet,
} from "@corbits-builder/plugin-host/facts";
import { unmetRequirement } from "@corbits-builder/plugin-host/text";
import {
  CheckList,
  CheckRan,
  CheckRecord,
  CheckRun,
  type AppBundle,
  type ArtifactList,
} from "@corbits-builder/schemas/artifact";
import {
  readProjectValues,
  type ProjectState,
} from "../values/project-values.ts";
import type { createArtifactService } from "../artifacts/service.ts";
import {
  CHECK_SKIPPED,
  checkNote,
  checkSkippedNote,
} from "../config/checks.ts";
import { opensNetwork } from "../config/preferences.ts";
import { checkRun, projectCoordinator } from "../db/schema.ts";
import type { Actor } from "../lib/actor.ts";
import { body } from "../http/route-parts.ts";
import { createHubMail } from "../mail/hub-mail.ts";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { requestErrorMetadata } from "../request-error.ts";
import { CATALOG, catalogOf, projectCatalog } from "./catalog.ts";
import { createCommandRunner } from "./command-runner.ts";
import { projectFacts } from "./facts.ts";

const log = getLogger(["corbits-builder", "hub", "checks"]);

// How much of one app file a check reads.
const READ_CHARS = 256 * 1024;
// The key a record names the app's version under whenever its check read any of the app.
const SEEN_AT = "commit";

type Artifacts = ReturnType<typeof createArtifactService>;
type Versions = Record<string, string | number | boolean | null>;
export type Row = typeof checkRun.$inferSelect;

const sha256 = (value: unknown) =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");

const installedCheck = (catalog: Catalog, plugin: string, action: string) =>
  catalog.actions
    .filter(isCheckAction)
    .find((check) => check.plugin === plugin && check.action === action);

/** What the hub has stored of a project that its checks read, with the latest record of each check. */
export type Stored = {
  listed: Pick<ArtifactList, "artifacts" | "preferences">;
  app: Awaited<ReturnType<Artifacts["savedApp"]>>;
  state: ProjectState;
  rows: readonly Row[];
  readDocument(filed: { artifactId: string; version: number }): Promise<string>;
  runCommand(
    bundle: AppBundle,
    command: CommandSteps,
    timeoutSeconds: number,
    openNetwork: boolean,
  ): Promise<CommandRun>;
};

/**
 * The project as saved, read the way a check reads it, and now(key) for what each thing a check
 * read is today: "app" the whole app's version, "path:<path>" whether the app has that path,
 * "file:<path>" a hash of that file's content or null without one, "document:<kind>" the current
 * version, "approval:<kind>" whether the person approved that version, "value:<name>" a hash of its
 * value, and "documents" and "facts" what is filed and what Builder works out from it. "commit"
 * names the app's version a check saw any of the app at, for the record only.
 */
export function savedProject({
  listed,
  app,
  state,
  rows,
  readDocument,
  runCommand,
}: Stored) {
  const byKind = new Map(listed.artifacts.map((item) => [item.kind, item]));
  let appVersion: string | undefined;
  if (app !== undefined)
    appVersion = "commit" in app ? app.commit : `v${app.version}`;
  const base = projectFacts({
    artifacts: listed.artifacts,
    preferences: listed.preferences,
    checks: [],
  });
  // Approved as the project's facts say, approvals the person handed to Builder included.
  const approvedNow = (kind: string) => base.has(approvalFact(kind));
  const now: Now = (key) => {
    const [what = "", name = ""] = key.split(/:(.*)/);
    if (what === "app" || what === SEEN_AT) return appVersion ?? null;
    if (what === "internet") return opensNetwork(listed.preferences);
    if (what === "path")
      return (
        app !== undefined &&
        (Object.hasOwn(app.bundle.files, name) ||
          Object.hasOwn(app.bundle.binary ?? {}, name))
      );
    if (what === "file") {
      const text = app?.bundle.files[name];
      return text === undefined ? null : sha256(text);
    }
    if (what === "documents") return [...byKind.keys()].sort().join(",");
    if (what === "facts") return [...base].sort().join(",");
    if (what === "document") return byKind.get(name)?.version ?? null;
    if (what === "approval") return approvedNow(name);
    if (what === "value") {
      const stored = readProjectValues([name], state, CATALOG.values)[name];
      return stored === null ? null : sha256(stored);
    }
    throw new Error(`A check recorded ${key}, which Builder does not read`);
  };
  // A fresh view for one run of a check, with what it read so far.
  const view = () => {
    const versions: Versions = {};
    const read = <T>(key: string, value: T) => {
      versions[key] = now(key);
      return value;
    };
    const inApp = <T>(key: string, value: T) => {
      read(SEEN_AT, undefined);
      return read(key, value);
    };
    const saved: Saved = {
      app: {
        get version() {
          return inApp("app", appVersion);
        },
        has: async (path) =>
          inApp(`path:${path}`, now(`path:${path}`) === true),
        read: async (path) =>
          inApp(`file:${path}`, app?.bundle.files[path]?.slice(0, READ_CHARS)),
        // A command reads the whole app, so its record goes stale with any change to it. It reaches
        // the hosts the project's builds do, so a build that fetches from another registry passes or
        // fails here as it does for the coder.
        run: async (command, timeoutSeconds) =>
          inApp(
            "app",
            app === undefined
              ? { error: NO_APP }
              : await runCommand(
                  app.bundle,
                  command,
                  timeoutSeconds,
                  read("internet", opensNetwork(listed.preferences)),
                ),
          ),
      },
      documents: {
        kinds: async () => read("documents", [...byKind.keys()]),
        read: async (kind) => {
          const filed = byKind.get(kind);
          read(`document:${kind}`, undefined);
          return filed && readDocument(filed);
        },
      },
      values: async (name) =>
        read(
          `value:${name}`,
          readProjectValues([name], state, CATALOG.values)[name],
        ),
      approvals: async (kind) => read(`approval:${kind}`, approvedNow(kind)),
      facts: async () => read("facts", base),
    };
    return { saved, versions };
  };
  const records = rows.map((row) => recordOf(row, now));
  // The latest records whose checks the hub re-runs on its own now, each with its installed check.
  const due = rows.flatMap((row, index) => {
    const action = installedCheck(CATALOG, row.plugin, row.action);
    const record = records[index];
    return action &&
      record &&
      rerunsOn(action.builder.rerun, staleReads(row.versions, now))
      ? [{ record, action }]
      : [];
  });
  // What is true of the project, a check's facts among it while its latest record stands.
  const facts = projectFacts({
    artifacts: listed.artifacts,
    preferences: listed.preferences,
    checks: records,
  });
  return { now, view, records, due, facts };
}
type Now = (key: string) => string | number | boolean | null;

// The reads of a record that no longer match what the project has saved. This is the only rule for
// whether a record is stale, and both a check's facts and its re-run use it. The version the app
// was seen at does not count, so a new commit leaves a record standing unless it changed what the
// check read.
const staleReads = (versions: Versions, now: Now) =>
  Object.entries(versions)
    .filter(([key, version]) => key !== SEEN_AT && now(key) !== version)
    .map(([key]) => key);

const isCurrent = (versions: Versions, now: Now) =>
  staleReads(versions, now).length === 0;

const valueReads = (versions: Versions): Versions =>
  Object.fromEntries(
    Object.entries(versions).filter(([key]) => key.startsWith("value:")),
  );

// How a run ended. unrecorded is what the run read when it left no record, as a failed hub re-run
// on a value does.
type Settled = { unrecorded?: Versions };

// Whether the hub re-runs a check on its own, given which of its latest record's reads went stale.
// A check that re-runs on a value looks only at the project values it read. When a saved app or
// document it read changes, its record stays stale until something else runs it.
const rerunsOn = (
  rerun: CheckAction["builder"]["rerun"],
  stale: readonly string[],
) => {
  if (rerun === "change") return stale.length > 0;
  if (rerun === "value") return stale.some((key) => key.startsWith("value:"));
  return false;
};

// The triggeredBy of a check run the hub starts on its own.
const BY_HUB = "hub";

/**
 * The record one run of a check adds and the note the coordinator may be sent about it. When the
 * hub re-runs a check that re-runs on a value, it only asks whether the fact still holds, so a
 * failure leaves nothing. The stale record it would replace already says the fact does not hold.
 * A failed record would look like a fault when a value simply changed, as when the app is
 * published to another target.
 */
export function runLeaves(
  action: CheckAction,
  run: { projectId: string; input: unknown },
  row: Pick<Row, "id" | "tenantId" | "triggeredBy">,
  { outcome, versions }: { outcome: CheckOutcome; versions: Versions },
) {
  if (
    !outcome.pass &&
    row.triggeredBy === BY_HUB &&
    action.builder.rerun === "value"
  )
    return undefined;
  const result = outcome.pass ? "pass" : "fail";
  return {
    record: {
      id: row.id,
      tenantId: row.tenantId,
      projectId: run.projectId,
      plugin: action.plugin,
      action: action.action,
      input: inputRecord(run.input),
      versions,
      result,
      summary: outcome.summary,
      evidence: [...outcome.evidence],
      triggeredBy: row.triggeredBy,
    } satisfies Omit<Row, "skippedBy" | "createdAt">,
    note: checkNote({
      name: action.name,
      checkId: row.id,
      result,
      summary: outcome.summary,
      evidence: outcome.evidence,
    }),
  };
}

const recordOf = (row: Row, now: Now): CheckRecord => {
  const record: CheckRecord = {
    checkId: row.id,
    plugin: row.plugin,
    action: row.action,
    input: row.input,
    result: row.result,
    summary: row.summary,
    evidence: row.evidence,
    versions: row.versions,
    current: isCurrent(row.versions, now),
    returns:
      installedCheck(CATALOG, row.plugin, row.action)?.returns(row.input) ?? [],
    triggeredBy: row.triggeredBy,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.skippedBy !== null) record.skippedBy = row.skippedBy;
  return record;
};

// The project's active coordinator and the person it runs for, whom a hub note is sent as.
async function coordinatorOf(db: DB["db"], projectId: string) {
  const [coordinator] = await db
    .select({
      runId: projectCoordinator.runId,
      tenantId: workflowRun.tenantId,
      principalId: workflowRunLaunchSpec.sourceAuthorityPrincipalId,
    })
    .from(projectCoordinator)
    .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
    .innerJoin(
      workflowRunLaunchSpec,
      eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
    )
    .where(
      and(
        eq(projectCoordinator.projectId, projectId),
        eq(projectCoordinator.active, true),
      ),
    );
  return coordinator;
}

/**
 * The hub's checks: the one place a check runs, always against the project as saved, each run
 * recorded with what it read and its result, and the coordinator told of each result it did not
 * wait on itself. A failed hub re-run of a check on a value is the exception: it leaves nothing.
 */
export function createChecks(deps: {
  db: DB["db"];
  // The toolchain folders every build sandbox reads, from the hub's environment.
  toolchains: SandboxToolchains;
  artifacts: Artifacts;
  fetch: (request: Request) => Promise<Response>;
}) {
  const { db, artifacts } = deps;
  const commands = createCommandRunner();

  // The latest record of each check of the project, one for each input it ran on.
  const latestRows = (projectId: string) =>
    db
      .selectDistinctOn([checkRun.plugin, checkRun.action, checkRun.input])
      .from(checkRun)
      .where(eq(checkRun.projectId, projectId))
      .orderBy(
        checkRun.plugin,
        checkRun.action,
        checkRun.input,
        desc(checkRun.createdAt),
      );

  const note = async (projectId: string, origin: string, content: string) => {
    const coordinator = await coordinatorOf(db, projectId);
    if (!coordinator) return;
    try {
      await createHubMail(
        db,
        deps.fetch,
        origin,
      )({
        tenantId: coordinator.tenantId,
        runId: coordinator.runId,
        principalId: coordinator.principalId,
        content,
      });
    } catch (error) {
      log.error("Check note not delivered", {
        projectId,
        coordinatorRunId: coordinator.runId,
        ...requestErrorMetadata(error),
      });
    }
  };

  // The project as saved now, with the latest record of each of its checks.
  const standing = async (actor: Actor, projectId: string) =>
    savedProject({
      listed: await artifacts.list(actor, projectId),
      app: await artifacts.savedApp(actor, projectId),
      state: await artifacts.projectState(actor, projectId),
      rows: await latestRows(projectId),
      readDocument: async ({ artifactId, version }) =>
        (await artifacts.read(actor, projectId, { artifactId, version }))
          .content,
      runCommand: (bundle, command, timeoutSeconds, openNetwork) =>
        commands.run(projectId, {
          bundle,
          command,
          timeoutMs: timeoutSeconds * 1000,
          openNetwork,
          toolchains: deps.toolchains,
        }),
    });

  const once = async (
    action: CheckAction,
    project: Awaited<ReturnType<typeof standing>>,
    input: unknown,
  ) => {
    const { saved, versions } = project.view();
    const outcome = await runCheck(action, saved, input);
    return { outcome, versions };
  };

  // A retrying check's attempts. Its last outcome is recorded as runLeaves says. It runs after its
  // start answered, so what goes wrong is logged here, and it settles as Settled says.
  const retrying = async (
    action: CheckAction,
    run: { actor: Actor; projectId: string; input: unknown; origin: string },
    retry: { everySeconds: number; forSeconds: number },
    row: Pick<Row, "id" | "tenantId" | "triggeredBy">,
  ): Promise<Settled> => {
    try {
      let versions: Versions = {};
      const outcome = await keepChecking(async () => {
        const attempt = await once(
          action,
          await standing(run.actor, run.projectId),
          run.input,
        );
        versions = attempt.versions;
        return attempt.outcome;
      }, retry);
      const left = runLeaves(action, run, row, { outcome, versions });
      if (!left) return { unrecorded: versions };
      await db.insert(checkRun).values(left.record);
      await note(run.projectId, run.origin, left.note);
    } catch (error) {
      log.error("A retrying check stopped", {
        projectId: run.projectId,
        check: action.name,
        ...requestErrorMetadata(error),
      });
    }
    return {};
  };

  // Runs an installed check once, or starts one that keeps trying, refused while what it requires
  // does not hold. triggeredBy names who asked; waited says the caller reads the result from the
  // answer, so the coordinator is not also sent a note of it. settled resolves once the run is
  // over, which for a retrying check is long after it answered.
  const begin = async (
    actor: Actor,
    projectId: string,
    action: CheckAction,
    input: unknown,
    caller: { triggeredBy: string; waited: boolean; origin: string },
  ) => {
    const checked = action.validate(input);
    if (!checked.ok)
      throw new ProjectError(400, "invalid_check_input", {
        hint: checked.text,
      });
    const project = await standing(actor, projectId);
    const own = unmet(
      (action.builder.requires ?? []).map((alternative) =>
        resolveFacts(alternative, checked.input),
      ),
      project.facts,
    );
    if (own.length > 0)
      throw new ProjectError(409, "check_requires_unmet", {
        hint: unmetRequirement(
          action.name,
          { own, steps: [] },
          makersIn(CATALOG),
          CATALOG.factText,
          "started",
        ),
      });
    const row = {
      id: crypto.randomUUID(),
      tenantId: actor.tenantId,
      triggeredBy: caller.triggeredBy,
    };
    const run = {
      actor,
      projectId,
      input: checked.input,
      origin: caller.origin,
    };
    const { speed } = action.builder;
    if (typeof speed === "object")
      return {
        answer: CheckRan.assert({
          started: true,
          checkId: row.id,
          plugin: action.plugin,
          action: action.action,
        }),
        settled: retrying(action, run, speed.retry, row),
      };
    const ran = await once(action, project, checked.input);
    const left = runLeaves(action, run, row, ran);
    if (left) {
      await db.insert(checkRun).values(left.record);
      if (!caller.waited) await note(projectId, caller.origin, left.note);
    }
    const result = ran.outcome.pass ? "pass" : "fail";
    return {
      answer: CheckRan.assert({
        ran: true,
        checkId: row.id,
        plugin: action.plugin,
        action: action.action,
        result,
        summary: ran.outcome.summary,
        evidence: ran.outcome.evidence,
      }),
      settled: Promise.resolve<Settled>(
        left ? {} : { unrecorded: ran.versions },
      ),
    };
  };

  const start = async (...args: Parameters<typeof begin>) =>
    (await begin(...args)).answer;

  // The stale records whose re-run has not settled yet, so a change saved meanwhile does not run
  // the same check again, even while a retrying check is still trying.
  const rerunning = new Set<string>();
  // The project values each stale record's last re-run read when it failed and recorded nothing.
  // The stale record stays the latest and stays due. Without this, every later save would run the
  // same check to the same failure, whatever it changed. The check runs again once one of those
  // values changes. The map lives only in memory, so a hub restart costs at most one more re-run.
  const failedOn = new Map<string, Versions>();

  // Re-runs, once each, the project's checks whose latest record went stale in a way they re-run
  // on. A re-run writes its record straight to the table, never through a saving route, so the
  // record does not count as a change itself. A re-run reads the project as the person who saved
  // the change.
  const rerun = async (actor: Actor, projectId: string, origin: string) => {
    const { due, now } = await standing(actor, projectId);
    for (const { record, action } of due) {
      const id = record.checkId;
      const failed = failedOn.get(id);
      if (rerunning.has(id) || (failed && isCurrent(failed, now))) continue;
      rerunning.add(id);
      try {
        const { answer, settled } = await begin(
          actor,
          projectId,
          action,
          record.input,
          { triggeredBy: BY_HUB, waited: false, origin },
        );
        const settling = settled
          .then(({ unrecorded }) => {
            if (unrecorded) failedOn.set(id, valueReads(unrecorded));
            else failedOn.delete(id);
          })
          .finally(() => rerunning.delete(id));
        if ("ran" in answer) await settling;
      } catch (error) {
        rerunning.delete(id);
        log.warn("A check did not re-run after a change", {
          projectId,
          check: action.name,
          staleCheckId: id,
          ...requestErrorMetadata(error),
        });
      }
    }
  };

  // After a change is saved, re-runs the checks that ask for it whose latest record the change made
  // stale. It answers once those have run; what goes wrong is logged here, since the change that set
  // it off is already saved.
  const changed = async (actor: Actor, projectId: string, origin: string) => {
    try {
      await rerun(actor, projectId, origin);
    } catch (error) {
      log.error("Checks were not re-run after a change", {
        projectId,
        ...requestErrorMetadata(error),
      });
    }
  };

  return {
    /** Runs a check the caller names, as start runs it. */
    async run(
      actor: Actor,
      projectId: string,
      raw: unknown,
      caller: { triggeredBy: string; waited: boolean; origin: string },
    ) {
      const asked = CheckRun(raw);
      if (asked instanceof type.errors)
        throw new ProjectError(400, "invalid_check_run", { issues: asked });
      const state = await artifacts.projectState(actor, projectId);
      const catalog = await projectCatalog(async (names) =>
        readProjectValues(names, state, CATALOG.values),
      );
      const action = installedCheck(catalog, asked.plugin, asked.action);
      if (!action)
        throw new ProjectError(404, "check_not_found", {
          plugin: asked.plugin,
          action: asked.action,
        });
      return start(actor, projectId, action, asked.input ?? {}, caller);
    },

    changed,

    /**
     * After a push moved the app repository's main, re-runs as changed does, reading the project as
     * the person its coordinator runs for; with no coordinator running, nothing is re-run.
     */
    async pushed(projectId: string, origin: string) {
      const coordinator = await coordinatorOf(db, projectId);
      if (!coordinator) return;
      await changed(
        {
          tenantId: coordinator.tenantId,
          principalId: coordinator.principalId,
        },
        projectId,
        origin,
      );
    },

    // The latest record of each check of the project, with whether it is still current.
    async latest(actor: Actor, projectId: string) {
      return (await standing(actor, projectId)).records;
    },

    /**
     * Records the person's skip of a check record: what it proves counts as true until the project
     * changes what that record read.
     */
    async skip(
      actor: Actor,
      projectId: string,
      checkId: string,
      origin: string,
    ) {
      const [skipped] = await db
        .select()
        .from(checkRun)
        .where(
          and(
            eq(checkRun.id, checkId),
            eq(checkRun.projectId, projectId),
            inArray(checkRun.result, ["pass", "fail"]),
          ),
        );
      if (!skipped)
        throw new ProjectError(404, "check_run_not_found", { checkId });
      const catalog = await catalogOf(artifacts.projectState, actor, projectId);
      if (
        installedCheck(catalog, skipped.plugin, skipped.action)?.builder
          .skip === "never"
      )
        throw new ProjectError(409, "check_not_skippable", {
          hint: `${skipped.plugin} ${skipped.action} cannot be skipped: what it proves counts only once it passes.`,
        });
      const { now } = await standing(actor, projectId);
      const row: Row = {
        id: crypto.randomUUID(),
        tenantId: actor.tenantId,
        projectId,
        plugin: skipped.plugin,
        action: skipped.action,
        input: skipped.input,
        versions: Object.fromEntries(
          Object.keys(skipped.versions).map((key) => [key, now(key)]),
        ),
        result: "skipped",
        summary: CHECK_SKIPPED,
        evidence: [`Its last result: ${skipped.summary}`],
        triggeredBy: `person:${actor.principalId}`,
        skippedBy: actor.principalId,
        createdAt: new Date(),
      };
      await db.insert(checkRun).values(row);
      await note(
        projectId,
        origin,
        checkSkippedNote({
          name: `${skipped.plugin} ${skipped.action}`,
          checkId: row.id,
          summary: skipped.summary,
        }),
      );
      return recordOf(row, now);
    },
  };
}
export type Checks = ReturnType<typeof createChecks>;

// A check's checked input as stored: its fields, or none.
const inputRecord = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null
    ? Object.fromEntries(Object.entries(input))
    : {};

// Who asked: a person, or the coordinator's run by its run token.
const triggeredBy = (c: Context<TenantEnv>) => {
  const caller = c.get("principal");
  return caller?.kind === "workflow" && caller.refId
    ? `run:${caller.refId}`
    : `person:${actorOf(c).principalId}`;
};

/** The routes that run, list and skip a project's checks. */
export function mountCheckRoutes(app: Hono<TenantEnv>, checks: Checks) {
  const security = [{ sessionCookie: [] }, { deviceBearer: [] }];
  const run = async (
    c: Context<TenantEnv>,
    projectId: string,
    waited: boolean,
  ) =>
    c.json(
      await checks.run(actorOf(c), projectId, await body(c), {
        triggeredBy: triggeredBy(c),
        waited,
        origin: new URL(c.req.url).origin,
      }),
    );
  const ran = {
    200: {
      description:
        "The check's result, or for one that keeps trying, the id its result is recorded under",
      content: { "application/json": { schema: resolver(CheckRan) } },
    },
    400: { description: "A check input the check does not take" },
    404: { description: "No installed check by that plugin and action" },
    409: { description: "What the check requires does not hold" },
  };
  app.get(
    "/:projectId/checks",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "listProjectChecks",
      description:
        "The latest record of each check of the project, one for each input it ran on: its result, evidence, what it read at which version, and whether all of that is still what the project has saved.",
      security: [...security, { coordinatorBearer: [] }],
      responses: {
        200: {
          description: "The latest record of each check",
          content: { "application/json": { schema: resolver(CheckList) } },
        },
      },
    }),
    async (c) =>
      c.json({
        checks: await checks.latest(actorOf(c), c.req.param("projectId")),
      }),
  );
  app.post(
    "/:projectId/checks",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "runProjectCheck",
      description:
        "The person runs a plugin's check against the project as saved; the coordinator is told its result in a hub note.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(CheckRun) } },
      },
      responses: ran,
    }),
    async (c) => run(c, c.req.param("projectId"), false),
  );
  app.post(
    "/:projectId/check-runs",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "runCoordinatorCheck",
      description:
        "The coordinator's execute runs a plugin's check against the project as saved and reads its result from the answer.",
      security: [{ coordinatorBearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(CheckRun) } },
      },
      responses: ran,
    }),
    async (c) => run(c, c.req.param("projectId"), true),
  );
  app.post(
    "/:projectId/checks/:checkId/skip",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "skipProjectCheck",
      description:
        "The person skips a check by one of its records: what it proves counts as true until the project changes what that record read. The coordinator is told in a hub note.",
      security,
      responses: {
        200: {
          description: "The skip, as the check's latest record",
          content: { "application/json": { schema: resolver(CheckRecord) } },
        },
        404: { description: "No check record by that id in the project" },
        409: {
          description:
            "A check its plugin declares the person may never skip, since only its passing may make what it proves true",
        },
      },
    }),
    async (c) =>
      c.json(
        await checks.skip(
          actorOf(c),
          c.req.param("projectId"),
          c.req.param("checkId"),
          new URL(c.req.url).origin,
        ),
      ),
  );
}
