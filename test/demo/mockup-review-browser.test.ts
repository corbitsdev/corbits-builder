/**
 * The mockup review driven as the person in the real web app, on a dynamic coordinator: the
 * recorded weather designer files a design option, the coordinator opens designer review, the person
 * tags a place and sends a comment, a second designer acts on it, and the person approves the next
 * version. Writes the video, screenshots, the browser's console and network, and the raw trace to
 * DEMO_DIR.
 */
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type } from "arktype";
import { chromium, type Page } from "@playwright/test";
import type { ProjectExport } from "@corbits-builder/schemas/project";
import { startTestHub } from "../e2e/support/hub.ts";
import {
  findArtifact,
  FIXTURE_DIR,
  isQuestionPark,
  NonEmptyString,
  openQuestionPark,
  STAGE_DEADLINE_MS,
  withPipelineScenario,
  writeWeatherDocuments,
} from "../e2e/support/pipeline-driver.ts";
import {
  formatOpenAISseResponse,
  loadScenarioBundle,
  startRecordedModelServer,
  writeScenarioFixture,
  type ExchangeExpectation,
  type RecordedModelServer,
} from "../e2e/support/recorded-model.ts";
import { readStored } from "../baseline/recorder.ts";
import { signIn, startWebApp, watchPage } from "./browser.ts";

const DEMO_DIR = NonEmptyString.assert(process.env["DEMO_DIR"]);
const WEB_PORT = Number(NonEmptyString.assert(process.env["DEMO_WEB_PORT"]));
const WAIT_MS = 180_000;

const COMMENT = "Make the add city link a button.";
const LINE = "Keep everything else as it is.";
const TAGGED = "cities-add-link";
const coordinatorTools = ["execute", "question"];

// The concept and instruction the recorded weather coordinator gave its designer.
const concept = {
  label: "Adaptive weather-driven",
  direction:
    "Modern and sleek base: crisp neutrals, system sans-serif, generous whitespace, subtle depth, with frosted soft panels over the scene. The accent and background palette shift per weather condition and day/night (e.g. warm amber for hot, slate blue for rain, deep indigo for night). Flexible layout that reflows between phone and desktop.",
};
const lookIdeas =
  "Dynamic and flexible look that adapts its palette and full-screen weather animations to the current condition and time of day, with frosted readable panels.";
const instruction =
  "Design one adaptive, weather-driven UI for the Animated Weather App: full-screen animated weather scenes with palettes that shift with the weather, current conditions, 24-hour and 7-day forecasts, city search, saved cities, a compare view and settings, on phone and desktop.";
const redesign = `Change the ${concept.label} design as the person asked on its mockup. Their comment on the add city link of the cities screen: "${COMMENT}" They also wrote: "${LINE}"`;
const designerReport = "The weather-driven design is filed";
const redesignReport =
  "The add city link is a button now; the design is filed again as this concept's option.";

const RecordedRole = type(
  "'coordinator' | 'designer' | 'coder' | 'presenter' | 'writer' | 'reviewer'",
);

// What the coordinator's question call returned, as far as the assertions read it.
const QuestionResult = type({
  output: {
    decision: "string",
    version: "number | string",
    comments: type({ text: "string", at: "Record<string, unknown>" }).array(),
    "message?": "string",
  },
});

function coordinatorTurns() {
  const turn = (
    reply: Parameters<typeof formatOpenAISseResponse>[0],
    expect: ExchangeExpectation,
  ) => ({ sse: formatOpenAISseResponse(reply), expect });
  const review = (id: string, note: string) => ({
    toolCalls: [
      {
        id,
        name: "question",
        arguments: { plugin: "designer", action: "review", input: { note } },
      },
    ],
  });
  const design = (id: string, text: string) => ({
    toolCalls: [
      {
        id,
        name: "execute",
        arguments: {
          plugin: "designer",
          action: "mockup",
          input: { instruction: text, lookIdeas, concepts: [concept] },
        },
      },
    ],
  });
  return [
    turn(design("coord_design", instruction), {
      lastMessageRole: "user",
      requiredTools: coordinatorTools,
      userTextContains: "I just imported this project",
      toolResults: [],
    }),
    turn(
      { text: "A designer is drafting the weather look." },
      {
        lastMessageRole: "tool",
        requiredTools: coordinatorTools,
        toolResults: [
          { callId: "coord_design", toolName: "execute", isError: false },
        ],
      },
    ),
    turn(
      review(
        "coord_review_1",
        "The first weather design. Try it, tag what should change, or approve it.",
      ),
      {
        lastMessageRole: "user",
        requiredTools: coordinatorTools,
        userTextContains: designerReport,
        toolResults: [],
      },
    ),
    turn(design("coord_redesign", redesign), {
      lastMessageRole: "tool",
      requiredTools: coordinatorTools,
      toolResults: [
        {
          callId: "coord_review_1",
          toolName: "question",
          isError: false,
          contains: `"testid":"${TAGGED}"`,
        },
      ],
    }),
    turn(
      { text: "The designer is making the add city link a button." },
      {
        lastMessageRole: "tool",
        requiredTools: coordinatorTools,
        toolResults: [
          { callId: "coord_redesign", toolName: "execute", isError: false },
        ],
      },
    ),
    turn(review("coord_review_2", "The add city link is a button now."), {
      lastMessageRole: "user",
      requiredTools: coordinatorTools,
      userTextContains: redesignReport,
      toolResults: [],
    }),
    turn(
      { text: "The design is approved." },
      {
        lastMessageRole: "tool",
        requiredTools: coordinatorTools,
        toolResults: [
          {
            callId: "coord_review_2",
            toolName: "question",
            isError: false,
            contains: '"decision":"approved"',
          },
        ],
      },
    ),
    turn(
      { text: "The build plan comes next, from the approved design." },
      {
        lastMessageRole: "user",
        requiredTools: coordinatorTools,
        userTextContains: "The person chose the Adaptive weather-driven",
        toolResults: [],
      },
    ),
  ];
}

// The second designer starts from the recorded designer's files and makes the add city link a
// button, as the person's comment asked.
function redesignerTurns(
  recorded: readonly {
    responseSse: string;
    expect: { requiredTools: string[] };
  }[],
  firstCssLine: string,
) {
  const [writes] = recorded;
  if (writes === undefined)
    throw new Error("The recorded designer wrote nothing");
  const requiredTools = writes.expect.requiredTools;
  return [
    {
      sse: writes.responseSse,
      expect: {
        lastMessageRole: "user" as const,
        userTextContains: COMMENT,
        requiredTools,
        toolResults: [],
      },
    },
    {
      sse: formatOpenAISseResponse({
        toolCalls: [
          {
            id: "des2_edit",
            name: "edit_file",
            arguments: {
              path: ".builder/designs/styles.css",
              old_string: firstCssLine,
              new_string: `${firstCssLine}\n[data-testid="${TAGGED}"] { display: inline-block; padding: 0.5rem 1rem; border-radius: 999px; background: var(--primary); color: var(--primary-foreground); }`,
            },
          },
        ],
      }),
      expect: {
        lastMessageRole: "tool" as const,
        requiredTools,
        toolResults: ["des_write_css", "des_write_html", "des_write_doc"].map(
          (callId) => ({ callId, toolName: "write_file", isError: false }),
        ),
      },
    },
    {
      sse: formatOpenAISseResponse({
        toolCalls: [{ id: "des2_check", name: "check_design", arguments: {} }],
      }),
      expect: {
        lastMessageRole: "tool" as const,
        requiredTools,
        toolResults: [
          { callId: "des2_edit", toolName: "edit_file", isError: false },
        ],
      },
    },
    {
      sse: formatOpenAISseResponse({
        toolCalls: [
          { id: "des2_file", name: "file_design_option", arguments: {} },
        ],
      }),
      expect: {
        lastMessageRole: "tool" as const,
        requiredTools,
        toolResults: [
          {
            callId: "des2_check",
            toolName: "check_design",
            isError: false,
            contains: "check passed",
          },
        ],
      },
    },
    {
      sse: formatOpenAISseResponse({ text: redesignReport }),
      expect: {
        lastMessageRole: "tool" as const,
        requiredTools,
        toolResults: [
          {
            callId: "des2_file",
            toolName: "file_design_option",
            isError: false,
          },
        ],
      },
    },
  ];
}

// The first line of the stylesheet the recorded designer wrote, which the second one edits after.
function firstCssLine(sse: string): string {
  const args = sse
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .flatMap((line) => {
      const chunk = type({
        choices: type({
          "delta?": {
            "tool_calls?": type({
              index: "number",
              "function?": { "arguments?": "string" },
            }).array(),
          },
        }).array(),
      }).assert(JSON.parse(line.slice("data: ".length)));
      return chunk.choices.flatMap((choice) =>
        (choice.delta?.tool_calls ?? []).flatMap((call) =>
          call.index === 0 ? [call.function?.arguments ?? ""] : [],
        ),
      );
    })
    .join("");
  const { content } = type({ path: "string", content: "string" }).assert(
    JSON.parse(args),
  );
  return NonEmptyString.assert(content.split("\n")[0]);
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: join(DEMO_DIR, `${name}.png`) });
}

type Hub = Awaited<ReturnType<typeof startTestHub>>;
type Project = { hub: Hub; tenantId: string; projectId: string };

async function designState({ hub, tenantId, projectId }: Project) {
  const { artifacts } = await hub.client.projectArtifacts(tenantId, projectId);
  return {
    option: findArtifact(artifacts, "design_option"),
    design: findArtifact(artifacts, "design"),
  };
}

// Waits on the hub, failing at once when the scripted model was asked something it did not expect.
async function until<T>(
  description: string,
  model: RecordedModelServer,
  check: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = performance.now() + WAIT_MS * 2;
  while (performance.now() < deadline) {
    const failure = model.firstFailure();
    if (failure) throw failure;
    const found = await check();
    if (found !== undefined) return found;
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

// The recorded weather project up to its first design option, which needs the approved
// requirements a designer's check reads, exported from a classic hub before the person chooses. An
// export leaves design options out, so the dynamic hub starts with the documents alone.
async function weatherDocuments(
  runs: Awaited<ReturnType<typeof loadScenarioBundle>>["runs"],
): Promise<ProjectExport> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "builder-demo-documents-"));
  // The recorded coordinator's turns up to presenting the design option; the rest need a choice.
  const presented = 24;
  try {
    await writeScenarioFixture(
      fixtureDir,
      { scenario: "mockup-review-documents", recordedFromCommit: "scripted" },
      runs
        .filter((run) => run.stage !== "build" && run.runKey !== "writer-5")
        .map((run) => ({
          runKey: run.runKey,
          role: RecordedRole.assert(run.role),
          stage: run.stage,
          sourceRunId: run.sourceRunId,
          exchanges: run.exchanges
            .slice(0, run.runKey === "coordinator-1" ? presented : undefined)
            .map((exchange) => ({
              sse: exchange.responseSse,
              expect: exchange.expect,
            })),
        })),
    );
    let exported: ProjectExport | undefined;
    await withPipelineScenario(
      {
        fixtureDir,
        projectId: "animated-weather-app",
        title: "Animated Weather App",
        problemStatement: "C: Weather App",
      },
      async (driver) => {
        await writeWeatherDocuments(driver);
        await driver.decideToolApproval({
          stage: "design",
          toolName: "design_app",
          afterApproved: { kind: "product_requirements", version: 1 },
        });
        await driver.waitForArtifactAndTurn(
          "design",
          { kind: "design_option", version: 1 },
          "The design is filed",
        );
        exported = await driver.hub.client.exportProject(
          driver.projectTenantId,
          driver.projectId,
        );
      },
    );
    if (exported === undefined) throw new Error("Nothing was exported");
    return exported;
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

test(
  "a person reviews the mockup full page, comments on a tagged place, and approves the next version",
  async () => {
    await mkdir(DEMO_DIR, { recursive: true });
    const { runs } = await loadScenarioBundle(FIXTURE_DIR);
    const designer = runs.find((run) => run.runKey === "designer-1");
    if (designer === undefined) throw new Error("No recorded designer");
    const cssLine = firstCssLine(
      NonEmptyString.assert(designer.exchanges[0]?.responseSse),
    );
    const exported = await weatherDocuments(runs);

    const fixtureDir = await mkdtemp(join(tmpdir(), "builder-demo-review-"));
    let model: RecordedModelServer | undefined;
    let hub: Hub | undefined;
    try {
      await writeScenarioFixture(
        fixtureDir,
        { scenario: "mockup-review", recordedFromCommit: "scripted" },
        [
          {
            runKey: "coordinator-1",
            role: "coordinator",
            stage: "design",
            sourceRunId: "run_mockup_review_coordinator",
            exchanges: coordinatorTurns(),
          },
          {
            runKey: "designer-1",
            role: "designer",
            stage: "design",
            sourceRunId: designer.sourceRunId,
            exchanges: designer.exchanges.map((exchange) => ({
              sse: exchange.responseSse,
              expect: exchange.expect,
            })),
          },
          {
            runKey: "designer-2",
            role: "designer",
            stage: "design",
            sourceRunId: "run_mockup_review_redesigner",
            exchanges: redesignerTurns(designer.exchanges, cssLine),
          },
        ],
      );
      const scripted = await startRecordedModelServer(fixtureDir);
      model = scripted;
      hub = await startTestHub(scripted, { coordinatorMode: "dynamic" });
      const { client, workspaceTenantId } = hub;
      const { projectId } = await client.importProject(
        workspaceTenantId,
        exported,
      );
      const listing = await client.project(workspaceTenantId, projectId);
      const tenantId = listing.tenantId;
      const coordinatorRunId = NonEmptyString.assert(listing.coordinatorRunId);
      const project = { hub, tenantId, projectId };
      await until("the first review to open", scripted, async () => {
        const { events } = await client.conversationEvents(tenantId, projectId);
        return openQuestionPark(events);
      });
      const before = await designState(project);

      let consoleLines: string[] = [];
      let network: Record<string, unknown>[] = [];
      const { web, url } = await startWebApp(hub.baseUrl, WEB_PORT);
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          recordVideo: { dir: DEMO_DIR, size: { width: 1280, height: 800 } },
        });
        const page = await context.newPage();
        ({ consoleLines, network } = watchPage(page, /\/answers$/));
        const review = page.locator('[data-slot="mockup-review"]');
        const roomPage = page.locator('[data-slot="room-page"]');
        const mockup = page.frameLocator(
          '[data-slot="room-page"] iframe[data-slot="gui-frame"]',
        );
        try {
          await signIn(page, url);
          await page.goto(`${url}/project/${projectId}`);
          await review.waitFor({ timeout: WAIT_MS });
          await mockup
            .locator('[data-screen="home"]')
            .first()
            .waitFor({ state: "attached", timeout: WAIT_MS });
          await roomPage.locator('[data-slot="composer"]').waitFor();
          await shoot(page, "01-review-open-full-page");

          await page
            .getByRole("combobox", { name: "Screen" })
            .selectOption({ label: "cities / populated" });
          const tagged = mockup.locator(`[data-testid="${TAGGED}"]`);
          await tagged.waitFor({ state: "visible", timeout: WAIT_MS });
          await shoot(page, "02-switched-to-cities");

          await review.getByRole("button", { name: "Tag" }).click();
          await tagged.click();
          const form = review.locator('[data-slot="comment-form"]');
          await form.waitFor();
          await form.locator("textarea").fill(COMMENT);
          await shoot(page, "03-tagged-place-and-comment");
          await form.getByRole("button", { name: "Add" }).click();
          await review
            .locator('[data-slot="comments"]')
            .getByText(COMMENT)
            .waitFor();
          await shoot(page, "04-comment-in-sidebar");

          const composer = roomPage.locator('[data-slot="composer"] textarea');
          await composer.fill(LINE);
          await shoot(page, "05-line-in-prompt-box");
          await composer.press("Enter");
          await roomPage.waitFor({ state: "detached", timeout: WAIT_MS });
          await shoot(page, "06-review-closed-back-in-conversation");

          await review
            .locator('[data-slot="last-round"]')
            .getByText(COMMENT)
            .waitFor({ timeout: WAIT_MS * 2 });
          await shoot(page, "07-second-review-with-last-round");
          const approve = review.locator(
            'button:not([disabled]):text-is("Approve")',
          );
          await approve.waitFor({ timeout: WAIT_MS });
          await approve.click();
          await roomPage.waitFor({ state: "detached", timeout: WAIT_MS });
          await page
            .getByText("The design is approved.")
            .first()
            .waitFor({ timeout: WAIT_MS });
          await shoot(page, "08-approved-back-in-conversation");
        } catch (error) {
          await shoot(page, "99-failure");
          throw error;
        } finally {
          await context.close();
          await page.video()?.saveAs(join(DEMO_DIR, "mockup-review.webm"));
          await page.video()?.delete();
        }
      } finally {
        await writeFile(join(DEMO_DIR, "console.log"), consoleLines.join("\n"));
        await writeFile(
          join(DEMO_DIR, "network.log"),
          network.map((entry) => JSON.stringify(entry)).join("\n"),
        );
        await browser.close();
        web.kill();
        await web.exited;
      }

      await until("the coordinator's last reply", scripted, async () => {
        const { turns } = await client.conversationEvents(tenantId, projectId);
        return turns?.find((turn) =>
          turn.text.includes("The build plan comes next"),
        );
      });
      const after = await designState(project);
      const stored = await readStored(hub, coordinatorRunId, 10);
      if (stored instanceof Error) throw stored;
      const answers = stored.toolCalls
        .filter((call) => call.name === "question")
        .map(
          (call) =>
            QuestionResult.assert(
              JSON.parse(NonEmptyString.assert(call.result?.text)),
            ).output,
        );
      const redesigner = stored.toolCalls.find(
        (call) =>
          call.name === "execute" &&
          JSON.stringify(call.arguments).includes(COMMENT),
      );
      const { events, turns } = await client.conversationEvents(
        tenantId,
        projectId,
      );
      const trace = {
        before,
        after,
        artifacts: await client.projectArtifacts(tenantId, projectId),
        coordinator: {
          runId: coordinatorRunId,
          received: stored.personTexts,
          said: stored.assistantTexts,
          toolCalls: stored.toolCalls,
        },
        questionEvents: events.filter(
          (event) => isQuestionPark(event) || event.type === "SignalReceived",
        ),
        personSaw: turns,
        browserCalls: network.filter((entry) => "received" in entry),
      };
      await writeFile(
        join(DEMO_DIR, "trace.json"),
        JSON.stringify(trace, null, 2),
      );

      const [changes, approved] = answers;
      expect(changes?.decision).toBe("changes");
      expect(changes?.message).toBe(LINE);
      expect(changes?.comments.map((comment) => comment.text)).toEqual([
        COMMENT,
      ]);
      expect(changes?.comments[0]?.at).toMatchObject({
        page: "index.html",
        screen: "cities",
        state: "populated",
        testid: TAGGED,
      });
      expect(redesigner?.result?.isError).toBe(false);
      expect(approved?.decision).toBe("approved");
      expect(approved?.version).toBe(after.option?.version);
      expect(after.option?.version).toBe(2);
      expect(after.design?.approvedVersion).toBe(after.design?.version);
      scripted.assertClean();
    } finally {
      if (hub) await hub.close();
      if (model) await model.stop();
      await rm(fixtureDir, { recursive: true, force: true });
    }
  },
  STAGE_DEADLINE_MS * 8,
);
