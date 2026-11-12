/**
 * The font change flow driven as the person in the real web app: its dev server proxies a test hub
 * on the scripted weather fixture, and a headless browser records the pass. Writes the video,
 * screenshots, the browser's console and network, and the raw trace to DEMO_DIR.
 */
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type } from "arktype";
import { chromium, type Page } from "@playwright/test";
import {
  buildWeatherApp,
  findArtifact,
  FIXTURE_DIR,
  isQuestionPark,
  NonEmptyString,
  STAGE_DEADLINE_MS,
  withPipelineScenario,
  type PipelineDriver,
} from "../e2e/support/pipeline-driver.ts";
import {
  formatOpenAISseResponse,
  loadScenarioBundle,
  writeScenarioFixture,
  type ExchangeExpectation,
} from "../e2e/support/recorded-model.ts";
import { readRunConversation } from "../e2e/support/extract.ts";
import { readStored } from "../baseline/recorder.ts";
import { signIn, startWebApp, watchPage } from "./browser.ts";

const DEMO_DIR = NonEmptyString.assert(process.env["DEMO_DIR"]);
const WEB_PORT = Number(NonEmptyString.assert(process.env["DEMO_WEB_PORT"]));
const FONT_KEYS = ["look.font-primary", "look.font-secondary"];
const WAIT_MS = 180_000;

const RecordedRole = type(
  "'coordinator' | 'designer' | 'coder' | 'presenter' | 'writer' | 'reviewer'",
);
const CoderStarted = type({ runId: "string > 0" });

function withRequiredTools(
  requiredTools: readonly string[],
  exchanges: readonly {
    sse: string;
    expect: Omit<ExchangeExpectation, "requiredTools">;
  }[],
) {
  return exchanges.map((exchange) => ({
    sse: exchange.sse,
    expect: { ...exchange.expect, requiredTools: [...requiredTools] },
  }));
}

// The coordinator's and coder's turns from pipeline.test.ts's font change test.
const inUse = { proposed: { secondary: "Space Mono" } };
const input = { proposed: { primary: "Arial" } };
const output = {
  primary: { name: "Arial", lists: ["sans"], license: "free" },
  secondary: { name: "Bitter", lists: ["serif"], license: "free" },
};
const themeImport = '@import "@corbits/react-ui/theme.css";\n';
const report =
  "Body text is now Arial and headings are Bitter; check-app passed.";
const fontTurns = withRequiredTools(
  ["question", "instruct_coder"],
  [
    {
      sse: formatOpenAISseResponse({
        toolCalls: [
          {
            id: "coord_fonts_in_use",
            name: "question",
            arguments: {
              plugin: "designer",
              action: "pick-fonts",
              input: inUse,
            },
          },
        ],
      }),
      expect: {
        lastMessageRole: "user",
        userTextContains: "the font is ugly",
        toolResults: [],
      },
    },
    {
      sse: formatOpenAISseResponse({
        toolCalls: [
          {
            id: "coord_fonts",
            name: "question",
            arguments: { plugin: "designer", action: "pick-fonts", input },
          },
        ],
      }),
      expect: {
        lastMessageRole: "tool",
        toolResults: [
          {
            callId: "coord_fonts_in_use",
            toolName: "question",
            isError: true,
            contains: "designer pick-fonts was not shown. One field is wrong.",
          },
        ],
      },
    },
    {
      sse: formatOpenAISseResponse({
        toolCalls: [
          {
            id: "coord_font_change",
            name: "instruct_coder",
            arguments: {
              instruction:
                "Set the app's body text in Arial and its headings in Bitter, the fonts the person picked. Change nothing else.",
            },
          },
        ],
      }),
      expect: {
        lastMessageRole: "tool",
        toolResults: [
          {
            callId: "coord_fonts",
            toolName: "question",
            isError: false,
            keys: ["output"],
            contains: JSON.stringify({ output }),
          },
        ],
      },
    },
    {
      sse: formatOpenAISseResponse({
        text: "The coder is switching the fonts to Arial and Bitter.",
      }),
      expect: {
        lastMessageRole: "tool",
        toolResults: [
          {
            callId: "coord_font_change",
            toolName: "instruct_coder",
            isError: false,
            keys: ["runId", "role"],
          },
        ],
      },
    },
    {
      sse: formatOpenAISseResponse({
        text: "Your saved fonts are in the design.",
      }),
      expect: {
        lastMessageRole: "user",
        userTextContains:
          'The person saved look tweaks to the design in a new version of the filed design\'s styles.css: --font-sans: "Arial",',
        toolResults: [],
      },
    },
    {
      sse: formatOpenAISseResponse({
        text: "Your app now uses Arial and Bitter.",
      }),
      expect: {
        lastMessageRole: "user",
        userTextContains: report,
        toolResults: [],
      },
    },
  ],
);
const coderTurns = withRequiredTools(
  ["edit_file", "run_shell", "mail_reply"],
  [
    {
      sse: formatOpenAISseResponse({
        toolCalls: [
          {
            id: "coder_fonts",
            name: "edit_file",
            arguments: {
              path: "client/src/styles.css",
              old_string: themeImport,
              new_string:
                themeImport +
                '\nbody {\n  font-family: "Arial", sans-serif;\n}\n\nh1,\nh2,\nh3 {\n  font-family: "Bitter", serif;\n}\n',
            },
          },
        ],
      }),
      expect: {
        lastMessageRole: "user",
        userTextContains: "Arial and its headings in Bitter",
        toolResults: [],
      },
    },
    {
      sse: formatOpenAISseResponse({
        toolCalls: [
          {
            id: "coder_fonts_check",
            name: "run_shell",
            // check-app outlasts run_shell's 30-second default on a busy machine.
            arguments: { command: "check-app", timeout: 180_000 },
          },
        ],
      }),
      expect: {
        lastMessageRole: "tool",
        toolResults: [
          { callId: "coder_fonts", toolName: "edit_file", isError: false },
        ],
      },
    },
    {
      sse: formatOpenAISseResponse({ text: report }),
      expect: {
        lastMessageRole: "tool",
        toolResults: [
          {
            callId: "coder_fonts_check",
            toolName: "run_shell",
            isError: false,
            contains: "The app is filed as version 3.",
          },
        ],
      },
    },
  ],
);

async function snapshot(driver: PipelineDriver) {
  const { client } = driver.hub;
  const { projectTenantId, projectId } = driver;
  const [values, { artifacts }, apps] = await Promise.all([
    client.projectValues(projectTenantId, projectId, FONT_KEYS),
    client.projectArtifacts(projectTenantId, projectId),
    client.appVersions(projectTenantId, projectId),
  ]);
  return {
    values: values.values,
    design: findArtifact(artifacts, "design"),
    app: findArtifact(artifacts, "app"),
    appVersions: apps.versions.map((version) => version.version),
  };
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: join(DEMO_DIR, `${name}.png`) });
}

test(
  "a person changes a built app's fonts through pick-fonts in the web app",
  async () => {
    await mkdir(DEMO_DIR, { recursive: true });
    const fixtureDir = await mkdtemp(join(tmpdir(), "builder-demo-fonts-"));
    const { manifest, runs } = await loadScenarioBundle(FIXTURE_DIR);
    try {
      await writeScenarioFixture(fixtureDir, manifest, [
        ...runs.map((run) => ({
          runKey: run.runKey,
          role: RecordedRole.assert(run.role),
          stage: run.stage,
          sourceRunId: run.sourceRunId,
          exchanges: [
            ...run.exchanges.map((exchange) => ({
              sse: exchange.responseSse,
              expect: exchange.expect,
            })),
            ...(run.runKey === "coordinator-1" ? fontTurns : []),
          ],
        })),
        {
          runKey: "coder-3",
          role: "coder",
          stage: "build",
          sourceRunId: "run_coder_font_change",
          exchanges: coderTurns,
        },
      ]);

      await withPipelineScenario(
        {
          fixtureDir,
          projectId: "animated-weather-app",
          title: "Animated Weather App",
          problemStatement: "C: Weather App",
        },
        async (driver) => {
          const { hub, projectTenantId, projectId, coordinatorRunId } = driver;
          const { client } = hub;
          await buildWeatherApp(driver);

          const before = await snapshot(driver);
          const storedBefore = await readStored(hub, coordinatorRunId, 10);
          if (storedBefore instanceof Error) throw storedBefore;
          const approvalsBefore = new Set(
            (
              await client.decidedApprovals(projectTenantId, projectId)
            ).approvals.map((approval) => approval.approvalId),
          );

          let consoleLines: string[] = [];
          let network: Record<string, unknown>[] = [];
          const { web, url } = await startWebApp(hub.baseUrl, WEB_PORT);
          const browser = await chromium.launch({ headless: true });
          try {
            const context = await browser.newContext({
              viewport: { width: 1280, height: 800 },
              recordVideo: {
                dir: DEMO_DIR,
                size: { width: 1280, height: 800 },
              },
            });
            const page = await context.newPage();
            ({ consoleLines, network } = watchPage(
              page,
              /\/values|\/answers$|\/mail$|\/approvals\//,
            ));

            try {
              await signIn(page, url);
              await page.goto(`${url}/project/${projectId}`);
              await page
                .getByText("filed as version 2")
                .first()
                .waitFor({ timeout: WAIT_MS });
              await shoot(page, "01-project-with-built-app");

              const composer = page.locator('[data-slot="composer"] textarea');
              await composer.fill("the font is ugly");
              await composer.press("Enter");
              await page
                .getByText("Choose your fonts")
                .waitFor({ timeout: WAIT_MS });
              await page.getByText("Proposed: Arial").waitFor();
              await shoot(page, "02-font-picker-proposal");

              await page
                .getByRole("button", { name: "Choose something else" })
                .click();
              await page.getByRole("combobox").fill("Arial");
              await page
                .getByRole("option", { name: "Arial", exact: true })
                .click();
              await page.getByRole("button", { name: /^Secondary/ }).click();
              await page.getByRole("combobox").fill("Bitter");
              await page
                .getByRole("option", { name: "Bitter", exact: true })
                .click();
              await shoot(page, "03-fonts-chosen");
              await page.getByRole("button", { name: "Save fonts" }).click();
              await page
                .getByText("Primary: Arial. Secondary: Bitter.")
                .waitFor({ timeout: WAIT_MS });
              await shoot(page, "04-font-picker-settled");

              const approve = page.getByRole("button", {
                name: "Yes, go ahead",
              });
              await approve.waitFor({ timeout: WAIT_MS });
              await shoot(page, "05-instruction-awaiting-approval");
              await approve.click();
              await approve.waitFor({ state: "detached", timeout: WAIT_MS });
              await shoot(page, "06-instruction-approved");

              await page
                .getByText("Your app now uses Arial and Bitter.")
                .waitFor({ timeout: WAIT_MS });
              await shoot(page, "07-coder-report-reached-coordinator");
            } catch (error) {
              await shoot(page, "99-failure");
              throw error;
            } finally {
              await context.close();
              await page.video()?.saveAs(join(DEMO_DIR, "font-change.webm"));
              await page.video()?.delete();
            }
          } finally {
            await writeFile(
              join(DEMO_DIR, "console.log"),
              consoleLines.join("\n"),
            );
            await writeFile(
              join(DEMO_DIR, "network.log"),
              network.map((entry) => JSON.stringify(entry)).join("\n"),
            );
            await browser.close();
            web.kill();
            await web.exited;
          }

          await driver.waitForArtifactAndTurn(
            "font-change",
            { kind: "app", version: 3 },
            "Your app now uses Arial and Bitter.",
          );
          const after = await snapshot(driver);
          const stored = await readStored(hub, coordinatorRunId, 10);
          if (stored instanceof Error) throw stored;
          const toolCalls = stored.toolCalls.slice(
            storedBefore.toolCalls.length,
          );
          const started = toolCalls.find(
            (call) => call.name === "instruct_coder",
          );
          const coderRunId = CoderStarted.assert(
            JSON.parse(NonEmptyString.assert(started?.result?.text)),
          ).runId;
          const coder = await readRunConversation(hub, coderRunId, "build");
          const { events, turns } = await client.conversationEvents(
            projectTenantId,
            projectId,
          );
          const decided = await client.decidedApprovals(
            projectTenantId,
            projectId,
          );
          const trace = {
            before,
            after,
            coordinator: {
              runId: coordinatorRunId,
              received: stored.personTexts.slice(
                storedBefore.personTexts.length,
              ),
              said: stored.assistantTexts.slice(
                storedBefore.assistantTexts.length,
              ),
              toolCalls,
            },
            coder: { runId: coderRunId, conversation: coder },
            questionEvents: events.filter(
              (event) =>
                isQuestionPark(event) || event.type === "SignalReceived",
            ),
            approvals: decided.approvals.filter(
              (approval) => !approvalsBefore.has(approval.approvalId),
            ),
            personSaw: turns?.slice(-8),
            browserCalls: network.filter((entry) => "received" in entry),
          };
          await writeFile(
            join(DEMO_DIR, "trace.json"),
            JSON.stringify(trace, null, 2),
          );
          expect(after.values).toEqual({
            "look.font-primary": "Arial",
            "look.font-secondary": "Bitter",
          });
        },
      );
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  },
  STAGE_DEADLINE_MS * 4,
);
