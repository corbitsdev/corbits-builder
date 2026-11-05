import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type } from "arktype";
import { reconstructDurableConversation } from "@intx/workflow-host";
import type { ConversationTurn } from "@intx/types/runtime";
import {
  formatOpenAISseResponse,
  type ExchangeExpectation,
  type ScenarioManifest,
} from "./recorded-model.ts";

const ToolCallArgs = type("Record<string, unknown>");
const StoredArtifactWrite = type({
  kind: "string > 0",
  title: "string > 0",
  content: "string > 0",
});
const StoredArtifactRecord = type("string.json.parse").to({
  artifactId: "string > 0",
  kind: "string > 0",
  version: "number.integer > 0",
  sha256: "string > 0",
});
const StoredFileWrite = type({
  path: "string > 0",
  content: "string",
});

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const DEFAULT_FIXTURE_DIR = join(REPO_ROOT, "test", "fixtures", "pipeline");
const DEFAULT_RUNS_ROOT =
  process.env.BUILDER_STORED_RUNS_DIR ??
  join(REPO_ROOT, "data", "hub", "workflow-runs");
const DEFAULT_LIVE_APP_WORKSPACE =
  process.env.BUILDER_STORED_APP_WORKSPACE ??
  join(REPO_ROOT, "data", "hub", "live-apps", "sb-4k5vv91vz", "workspace");

const MAX_SCENARIO_BYTES = 2 * 1024 * 1024;
const USER_MANUAL_PATH = "docs/USER-MANUAL.md";
const USER_MANUAL_SOURCE = join(import.meta.dir, "weather-app-user-manual.md");

const ZESTY_RUNS = {
  coordinatorDocs:
    "run_29495a64502566c30213588dc8b3fc08-zesty-acorn-badger-localhost",
  coordinatorDesign:
    "run_98b0933fb1dd1a2f28997bb3af54fb61-zesty-acorn-badger-localhost",
  coordinatorBuild:
    "run_4ede76a05ff267aa7a24166b496eac92-zesty-acorn-badger-localhost",
  writerConstraints:
    "run_2c1986a2c8dee7a4d192add5f8c5e7b9-zesty-acorn-badger-localhost",
  writerApproachesV1:
    "run_3433413723e3f2cad30adc8afe6d89ea-zesty-acorn-badger-localhost",
  writerApproachesV2:
    "run_0fbe70fbdcb7174d73f9815d9f5f7e0f-zesty-acorn-badger-localhost",
  writerRequirements:
    "run_f76d5bfdb487b00e753d417c942b721d-zesty-acorn-badger-localhost",
  writerBuildPlan:
    "run_e2cac090f6c422535d77e00a38387d62-zesty-acorn-badger-localhost",
  designer: "run_58cf9e8d726377fd10cf3b6d4c751bbc-zesty-acorn-badger-localhost",
  coder: "run_970c695116933ed8147c26bcad9a0a65-zesty-acorn-badger-localhost",
} as const;

type ToolCallSpec = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ExchangeSpec = {
  text?: string;
  toolCalls?: readonly ToolCallSpec[];
  expect: ExchangeExpectation;
};

type RunSpec = {
  runKey: string;
  role: string;
  stage: string;
  sourceRunId: string;
  exchanges: readonly ExchangeSpec[];
};

async function loadStoredTurns(
  runsRoot: string,
  runDir: string,
  step: string,
): Promise<readonly ConversationTurn[]> {
  if (!runDir.endsWith("-zesty-acorn-badger-localhost")) {
    throw new Error(
      `Refusing to read non-weather-app run directory: ${runDir}`,
    );
  }
  const dest = await mkdtemp(join(tmpdir(), "builder-extract-"));
  try {
    const proc = Bun.spawn(
      [
        "sh",
        "-c",
        `git -C "${join(runsRoot, runDir)}" archive --format=tar refs/heads/main agent-state | tar -x -C "${dest}"`,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    if ((await proc.exited) !== 0) {
      throw new Error(
        `Failed to unpack ${runDir}: ${await new Response(proc.stderr).text()}`,
      );
    }
    const conv = await reconstructDurableConversation(
      join(dest, "agent-state", step),
      step,
    );
    if (!conv) {
      throw new Error(`No durable conversation found in ${runDir} (${step})`);
    }
    return conv.turns;
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
}

function extractTurnText(turn: ConversationTurn | undefined): string {
  if (!turn) return "";
  return turn.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function extractToolCalls(turn: ConversationTurn | undefined): ToolCallSpec[] {
  if (!turn) return [];
  const calls: ToolCallSpec[] = [];
  for (const block of turn.content) {
    if (block.type !== "tool_call") continue;
    calls.push({
      id: block.id,
      // Recorded runs predate the deploy_worker -> deploy_writer rename.
      name: block.name === "deploy_worker" ? "deploy_writer" : block.name,
      arguments: ToolCallArgs.assert(block.arguments),
    });
  }
  return calls;
}

function extractToolResultText(
  turns: readonly ConversationTurn[],
  idx: number,
): string {
  const b = turns[idx]?.content[0];
  if (b?.type === "tool_result") {
    const first = b.content[0];
    const raw = first?.type === "text" ? first.text : "";
    const truncIdx = raw.indexOf("\n[Tool output truncated:");
    return truncIdx >= 0 ? raw.slice(0, truncIdx) : raw;
  }
  return "";
}

async function reconstructDesignFiles(
  runsRoot: string,
): Promise<{ stylesCss: string; indexHtml: string; designMd: string }> {
  const coderTurns = await loadStoredTurns(runsRoot, ZESTY_RUNS.coder, "build");
  const designTurns = await loadStoredTurns(
    runsRoot,
    ZESTY_RUNS.designer,
    "design",
  );
  const starterCss = await readFile(
    join(
      REPO_ROOT,
      "workflows",
      "designer",
      "starter",
      ".builder",
      "designs",
      "styles.css",
    ),
    "utf8",
  );
  const starterHtml = await readFile(
    join(
      REPO_ROOT,
      "workflows",
      "designer",
      "starter",
      ".builder",
      "designs",
      "index.html",
    ),
    "utf8",
  );

  const c20 = extractToolResultText(coderTurns, 20);
  const c20BeforeTabs = c20.slice(
    0,
    c20.indexOf("transition: transform var(--du"),
  );
  const starterSwitchTail = starterCss.slice(
    starterCss.indexOf("transition: transform var(--du"),
  );
  const c24 = extractToolResultText(coderTurns, 24);
  const c26 = extractToolResultText(coderTurns, 26);
  const c28 = extractToolResultText(coderTurns, 28).split("\n1:221:")[0]!;
  const c24Clean = c24.slice(
    0,
    c24.lastIndexOf(
      "  animation: twinkle 4s var(--ease-in-out) infinite alternate;",
    ),
  );
  const c26Clean = c26.slice(
    0,
    c26.lastIndexOf(".city-cond { grid-column: 3; color: var(--muted-foregr"),
  );
  const weatherLayer = `${c24Clean}${c26Clean}${c28}`.replaceAll(
    /^\s*(?:-webkit-)?backdrop-filter:\s*blur\(18px\)\s*saturate\(1\.3\);\n/gm,
    "",
  );
  const fullStylesCss = `${c20BeforeTabs}${starterSwitchTail}\n${weatherLayer.trimEnd()}\n`;

  const workDir = await mkdtemp(join(tmpdir(), "builder-design-gen-"));
  try {
    await mkdir(join(workDir, ".builder", "designs"), { recursive: true });
    await mkdir(join(workDir, ".scratch"), { recursive: true });
    await writeFile(
      join(workDir, ".builder", "designs", "styles.css"),
      fullStylesCss,
    );

    const c30 = extractToolResultText(coderTurns, 30);
    const svgStart = c30.indexOf("<svg width='0'");
    const svgEnd = c30.indexOf("<div class='scene'");
    const rawSprite = c30.slice(svgStart, svgEnd).trim();
    const extraIdx = rawSprite.indexOf("<symbol id='i-home'");
    const spriteSvg =
      extraIdx >= 0 ? `${rawSprite.slice(0, extraIdx)}</svg>` : rawSprite;
    await writeFile(join(workDir, ".scratch", "sprite.svg"), spriteSvg);

    const scriptHtml = starterHtml.slice(starterHtml.indexOf("    <script>"));
    await writeFile(join(workDir, ".scratch", "script.html"), scriptHtml);

    const genMjs = StoredFileWrite.assert(
      extractToolCalls(designTurns[55])[0]?.arguments,
    ).content;
    await writeFile(join(workDir, ".scratch", "gen.mjs"), genMjs);

    const designSrcMd = StoredFileWrite.assert(
      extractToolCalls(designTurns[67])[0]?.arguments,
    ).content;
    await writeFile(join(workDir, ".scratch", "DESIGN.src.md"), designSrcMd);

    const cmds = [
      `cd .builder/designs && node -e 'const s=require("fs").readFileSync("styles.css","utf8");const root=s.match(/^:root \\{\\n([\\s\\S]*?)\\n\\}/m)[1];const dark=s.match(/^\\.dark \\{\\n([\\s\\S]*?)\\n\\}/m)[1];require("fs").writeFileSync("../../.scratch/tokens.txt",":root {\\n"+root+"\\n}\\n.dark {\\n"+dark+"\\n}\\n@media (prefers-color-scheme: dark) {\\n  :root:not(.dark):not(.light) {\\n"+dark.split("\\n").map(l=>"  "+l).join("\\n")+"\\n  }\\n}\\n");'`,
      `cd .scratch && sed -i '' "s/<ol class='hours' data-testid='home-hours-list'>/<ol class='hours' data-testid='home-hours-list' tabindex='0' aria-label='Hourly forecast, scroll for more'>/" gen.mjs`,
      `cd .scratch && sed -i '' -E "s/data-screen='([a-z]+)'/data-screen=\\"\\1\\"/g; s/data-state='\\\\$\\\\{state\\\\}'/data-state=\\"\\\${state}\\"/; s/data-state='([a-z]+)'/data-state=\\"\\1\\"/g" gen.mjs`,
      `cd .scratch && sed -i '' -E 's/\\["<section data-screen="([a-z]+)" ([^"]*)>"\\]/[\`<section data-screen="\\1" \\2>\`]/' gen.mjs`,
      `cd .scratch && sed -i '' -e "s/<small class='pop' aria-label='\\\${p2}% chance of rain'>/<small class='pop'>/" -e "s/<span class='pop' aria-label='\\\${d.pop}% chance of rain'>/<span class='pop'>/" -e "s/<span class='lo' aria-label='Low \\\${deg(d.lo)}'>/<span class='lo'>/" -e "s/<b aria-label='High \\\${deg(d.hi)}'>/<b>/" gen.mjs`,
      `cd .scratch && sed -i '' -e "s/<li data-testid='home-hour-row'>/<li>/" -e "s/<li data-testid='home-day-row'>/<li>/" gen.mjs && node gen.mjs && sed -i '' -e 's/\`home-hours-list\`, \`home-hour-row\`, \`home-days-list\`, \`home-day-row\`/\`home-hours-list\` (24 \`li\` rows), \`home-days-list\` (7 \`li\` rows)/' DESIGN.src.md && node -e 'const fs=require("fs");const t=fs.readFileSync("tokens.txt","utf8");fs.writeFileSync("../.builder/DESIGN.md",fs.readFileSync("DESIGN.src.md","utf8").replace("@@TOKENS@@",t));'`,
    ];

    for (const cmd of cmds) {
      const p = Bun.spawn(["sh", "-c", cmd], {
        cwd: workDir,
        stdout: "ignore",
        stderr: "pipe",
      });
      if ((await p.exited) !== 0) {
        throw new Error(
          `Design reconstruction command failed: ${await new Response(p.stderr).text()}`,
        );
      }
    }

    const htmlRaw = await readFile(
      join(workDir, ".builder", "designs", "index.html"),
      "utf8",
    );
    const indexHtml = htmlRaw.replace(
      "    <title>Animated Weather</title>",
      '    <title>Animated Weather</title>\n    <meta name="theme-color" content="#3f5876" />',
    );
    const stylesCss = await readFile(
      join(workDir, ".builder", "designs", "styles.css"),
      "utf8",
    );
    const designMd = await readFile(
      join(workDir, ".builder", "DESIGN.md"),
      "utf8",
    );
    return { stylesCss, indexHtml, designMd };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function buildWriterRun(
  runsRoot: string,
  runKey: string,
  sourceRunDir: string,
  skillName: string,
  userTextContains: string,
): Promise<RunSpec> {
  const turns = await loadStoredTurns(runsRoot, sourceRunDir, "write");
  const writeCall = turns
    .flatMap((t) => extractToolCalls(t))
    .filter((c) => c.name === "write_artifact")
    .at(-1);
  if (!writeCall) {
    throw new Error(`No write_artifact call found in ${sourceRunDir}`);
  }
  StoredArtifactWrite.assert(writeCall.arguments);
  const writeResultBlock = turns
    .flatMap((t) => t.content)
    .find(
      (b): b is Extract<typeof b, { type: "tool_result" }> =>
        b.type === "tool_result" && b.callId === writeCall.id,
    );
  const writeResultText = writeResultBlock?.content.find(
    (c): c is Extract<typeof c, { type: "text" }> => c.type === "text",
  )?.text;
  if (!writeResultText) {
    throw new Error(`No write_artifact result found in ${sourceRunDir}`);
  }
  StoredArtifactRecord.assert(writeResultText);
  const finalTurn = turns.filter((t) => t.role === "assistant").at(-1);
  const finalText = extractTurnText(finalTurn);
  const skillCallId = `${runKey}_skill`;
  const writeCallId = `${runKey}_write`;

  return {
    runKey,
    role: "writer",
    stage: "documents",
    sourceRunId: sourceRunDir.replace(/-zesty-acorn-badger-localhost$/, ""),
    exchanges: [
      {
        toolCalls: [
          {
            id: skillCallId,
            name: "read_skill",
            arguments: { name: skillName },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains,
          requiredTools: ["read_skill", "write_artifact"],
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: writeCallId,
            name: "write_artifact",
            arguments: writeCall.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: ["read_skill", "write_artifact"],
          toolResults: [
            {
              callId: skillCallId,
              toolName: "read_skill",
              isError: false,
            },
          ],
        },
      },
      {
        text: finalText,
        expect: {
          lastMessageRole: "tool",
          requiredTools: ["read_skill", "write_artifact"],
          toolResults: [
            {
              callId: writeCallId,
              toolName: "write_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "sha256"],
            },
          ],
        },
      },
    ],
  };
}

function adaptSettingsTsx(source: string): string {
  const withoutDialogImport = source.replace(
    /import \{\n\s*Dialog,\n\s*DialogContent,\n\s*DialogDescription,\n\s*DialogFooter,\n\s*DialogHeader,\n\s*DialogTitle,\n\} from "@corbits\/react-ui\/ui\/dialog";\n/,
    "",
  );
  const oldModal = `      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="install-dialog">
          <DialogHeader>
            <DialogTitle>Put the weather on your home screen</DialogTitle>
            <DialogDescription>
              Installed, it opens full screen like any other app. No app store, no sign-in, and your cities stay in this
              browser.
            </DialogDescription>
          </DialogHeader>
          {install.canPrompt ? null : (
            <div className="px-6 text-sm">
              <p className="font-semibold">How to add it</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>iPhone or iPad (Safari): tap Share, then “Add to Home Screen”.</li>
                <li>Android (Chrome): open the ⋮ menu, then “Install app” or “Add to Home screen”.</li>
                <li>Computer (Chrome or Edge): click the install icon at the right of the address bar.</li>
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="install-cancel-button">
              {install.canPrompt ? "Not now" : "Close"}
            </Button>
            {install.canPrompt ? (
              <Button onClick={() => void confirmInstall()} data-testid="install-confirm-button">
                <Download />
                Install
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>`;
  const newModal = `      {open ? (
        <div className="scrim" data-open="true" onClick={() => setOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-dialog-title"
            data-testid="install-dialog"
            className="welcome"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="install-dialog-title" className="text-lg font-semibold">
              Put the weather on your home screen
            </h2>
            <p className="muted">
              Installed, it opens full screen like any other app. No app store, no sign-in, and your cities stay in this
              browser.
            </p>
            {install.canPrompt ? null : (
              <div className="text-sm">
                <p className="font-semibold">How to add it</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>iPhone or iPad (Safari): tap Share, then “Add to Home Screen”.</li>
                  <li>Android (Chrome): open the ⋮ menu, then “Install app” or “Add to Home screen”.</li>
                  <li>Computer (Chrome or Edge): click the install icon at the right of the address bar.</li>
                </ul>
              </div>
            )}
            <div className="row justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} data-testid="install-cancel-button">
                {install.canPrompt ? "Not now" : "Close"}
              </Button>
              {install.canPrompt ? (
                <Button onClick={() => void confirmInstall()} data-testid="install-confirm-button">
                  <Download />
                  Install
                </Button>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}`;
  if (!withoutDialogImport.includes("<Dialog open={open}")) {
    throw new Error("Expected <Dialog open={open}> in settings.tsx");
  }
  return withoutDialogImport.replace(oldModal, newModal);
}

async function loadWeatherAppSourceFiles(
  liveAppRoot: string,
): Promise<{ path: string; content: string }[]> {
  const entries: { path: string; content: string }[] = [];
  const paths = (
    await Array.fromAsync(
      new Bun.Glob("**/*").scan({ cwd: liveAppRoot, dot: false }),
    )
  ).sort();
  for (const rel of paths) {
    if (
      rel.startsWith("node_modules/") ||
      rel.includes("/node_modules/") ||
      rel.startsWith("client/dist/") ||
      rel.endsWith("package.json") ||
      rel.endsWith("tsconfig.json") ||
      rel === "bun.lock" ||
      rel === "verify.mjs" ||
      rel === "client/vite.config.js" ||
      rel === "client/vite.config.ts"
    ) {
      continue;
    }
    if (
      rel.endsWith(".js") &&
      ((await Bun.file(
        join(liveAppRoot, rel.replace(/\.js$/, ".ts")),
      ).exists()) ||
        (await Bun.file(
          join(liveAppRoot, rel.replace(/\.js$/, ".tsx")),
        ).exists()))
    ) {
      continue;
    }
    const raw = await readFile(join(liveAppRoot, rel), "utf8");
    const content =
      rel === "client/src/pages/settings.tsx" ? adaptSettingsTsx(raw) : raw;
    entries.push({ path: rel, content });
  }
  return entries;
}

async function directoryBytes(dir: string): Promise<number> {
  let total = 0;
  for await (const rel of new Bun.Glob("**/*").scan({
    cwd: dir,
    onlyFiles: true,
  })) {
    const info = await stat(join(dir, rel));
    total += info.size;
  }
  return total;
}

export async function extractWeatherAppFixture(options?: {
  runsRoot?: string;
  liveAppWorkspace?: string;
  fixtureDir?: string;
}): Promise<{ fixtureDir: string; totalBytes: number }> {
  const runsRoot = options?.runsRoot ?? DEFAULT_RUNS_ROOT;
  const liveAppWorkspace =
    options?.liveAppWorkspace ?? DEFAULT_LIVE_APP_WORKSPACE;
  const fixtureDir = options?.fixtureDir ?? DEFAULT_FIXTURE_DIR;

  const coord1 = await loadStoredTurns(
    runsRoot,
    ZESTY_RUNS.coordinatorDocs,
    "coordinate",
  );
  const coord2 = await loadStoredTurns(
    runsRoot,
    ZESTY_RUNS.coordinatorDesign,
    "coordinate",
  );
  const coord3 = await loadStoredTurns(
    runsRoot,
    ZESTY_RUNS.coordinatorBuild,
    "coordinate",
  );
  const designTurns = await loadStoredTurns(
    runsRoot,
    ZESTY_RUNS.designer,
    "design",
  );
  const coderTurns = await loadStoredTurns(runsRoot, ZESTY_RUNS.coder, "build");

  const coord1Calls = coord1.flatMap((t) => extractToolCalls(t));
  const coord2Calls = coord2.flatMap((t) => extractToolCalls(t));
  const coord3Calls = coord3.flatMap((t) => extractToolCalls(t));

  const briefWriteCall = coord1Calls.find((c) => c.name === "write_artifact")!;
  StoredArtifactWrite.assert(briefWriteCall.arguments);
  const deployWriterCalls = coord1Calls.filter(
    (c) => c.name === "deploy_writer",
  );
  const deployConstraintsCall = deployWriterCalls.find(
    (c) => c.arguments.kind === "constraints",
  )!;
  const deployApproachesCalls = deployWriterCalls.filter(
    (c) => c.arguments.kind === "approaches",
  );
  const deployApproachesV1Call = deployApproachesCalls[0]!;
  const deployApproachesV2Call = deployApproachesCalls[1]!;
  const deployRequirementsCall = deployWriterCalls.find(
    (c) => c.arguments.kind === "product_requirements",
  )!;
  const designAppCall = coord2Calls.find((c) => c.name === "design_app")!;
  const deployBuildPlanCall = coord3Calls.find(
    (c) => c.name === "deploy_writer" && c.arguments.kind === "build_plan",
  )!;
  const deployCoderCall = coord3Calls.find((c) => c.name === "deploy_coder")!;
  const instructCoderCall = coord3Calls.find(
    (c) => c.name === "instruct_coder",
  )!;

  const coordinatorTools = [
    "read_artifact",
    "write_artifact",
    "request_approval",
    "deploy_writer",
    "review_artifact",
    "design_app",
    "deploy_coder",
    "instruct_coder",
    "choose_design",
  ];

  const coordinatorRun: RunSpec = {
    runKey: "coordinator-1",
    role: "coordinator",
    stage: "project",
    sourceRunId: "run_29495a64502566c30213588dc8b3fc08",
    exchanges: [
      {
        text: extractTurnText(coord1[1]),
        expect: {
          lastMessageRole: "user",
          userTextContains: "Weather App",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_skill_brief",
            name: "read_skill",
            arguments: { name: "problem-brief" },
          },
          {
            id: "coord_read_init",
            name: "read_artifact",
            arguments: {},
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "Open-Meteo",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_write_brief",
            name: "write_artifact",
            arguments: briefWriteCall.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_skill_brief",
              toolName: "read_skill",
              isError: false,
            },
            {
              callId: "coord_read_init",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifacts", "inFlight", "preferences"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord1[7]),
        toolCalls: [
          {
            id: "coord_approve_brief",
            name: "request_approval",
            arguments: { kinds: ["problem_brief"] },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_write_brief",
              toolName: "write_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "sha256"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_deploy_constraints",
            name: "deploy_writer",
            arguments: deployConstraintsCall.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_approve_brief",
              toolName: "request_approval",
              isError: false,
              keys: ["approved"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord1[11]),
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_deploy_constraints",
              toolName: "deploy_writer",
              isError: false,
              keys: ["runId", "role", "status"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_read_constraints",
            name: "read_artifact",
            arguments: { kind: "constraints" },
          },
          {
            id: "coord_review_constraints",
            name: "review_artifact",
            arguments: {
              kind: "constraints",
              instruction:
                "Check that the constraints document covers the Open-Meteo proxy, 60fps canvas animation performance, WCAG AA contrast, and browser-only persistence from the Problem Brief.",
            },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "written the limits for your weather app",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        text: "The Constraints document is drafted and I've asked the reviewer to check it against the Problem Brief.",
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_read_constraints",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "content"],
            },
            {
              callId: "coord_review_constraints",
              toolName: "review_artifact",
              isError: false,
              keys: ["runId", "role", "status"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord1[15]),
        toolCalls: [
          {
            id: "coord_approve_constraints",
            name: "request_approval",
            arguments: { kinds: ["constraints"] },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "Engineering review of constraints",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_deploy_approaches_v1",
            name: "deploy_writer",
            arguments: deployApproachesV1Call.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_approve_constraints",
              toolName: "request_approval",
              isError: false,
              keys: ["approved"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord1[19]),
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_deploy_approaches_v1",
              toolName: "deploy_writer",
              isError: false,
              keys: ["runId", "role", "status"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_read_approaches_v1",
            name: "read_artifact",
            arguments: { kind: "approaches" },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "three ways to build the app",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        text: extractTurnText(coord1[23]),
        toolCalls: [
          {
            id: "coord_approve_approaches_v1",
            name: "request_approval",
            arguments: { kinds: ["approaches"] },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_read_approaches_v1",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "content"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_deploy_approaches_v2",
            name: "deploy_writer",
            arguments: deployApproachesV2Call.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_approve_approaches_v1",
              toolName: "request_approval",
              isError: true,
              contains: "I think Approach B is the best",
            },
          ],
        },
      },
      {
        text:
          extractTurnText(coord1[27]) ||
          "I'm updating the Approaches document to record Approach B as the chosen approach.",
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_deploy_approaches_v2",
              toolName: "deploy_writer",
              isError: false,
              keys: ["runId", "role", "status"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_read_approaches_v2",
            name: "read_artifact",
            arguments: { kind: "approaches" },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "updated the approaches document",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        text:
          extractTurnText(coord1[31]) ||
          "The updated Approaches document is ready for your approval.",
        toolCalls: [
          {
            id: "coord_approve_approaches_v2",
            name: "request_approval",
            arguments: { kinds: ["approaches"] },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_read_approaches_v2",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "content"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_deploy_requirements",
            name: "deploy_writer",
            arguments: deployRequirementsCall.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_approve_approaches_v2",
              toolName: "request_approval",
              isError: false,
              keys: ["approved"],
            },
          ],
        },
      },
      {
        text:
          extractTurnText(coord1[35]) ||
          "The Approaches document is approved. I've started the Product Requirements writer.",
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_deploy_requirements",
              toolName: "deploy_writer",
              isError: false,
              keys: ["runId", "role", "status"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_read_requirements",
            name: "read_artifact",
            arguments: { kind: "product_requirements", part: 1 },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "written the requirements for your weather app",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        text: extractTurnText(coord1[39]),
        toolCalls: [
          {
            id: "coord_approve_requirements",
            name: "request_approval",
            arguments: { kinds: ["product_requirements"] },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_read_requirements",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "content"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord2[1]),
        toolCalls: [
          {
            id: "coord_design_app",
            name: "design_app",
            arguments: {
              ...designAppCall.arguments,
              lookIdeas:
                typeof designAppCall.arguments["lookIdeas"] === "string" &&
                designAppCall.arguments["lookIdeas"].length > 0
                  ? designAppCall.arguments["lookIdeas"]
                  : "Dynamic and flexible look that adapts its palette and full-screen weather animations to the current condition and time of day, with frosted readable panels.",
            },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_approve_requirements",
              toolName: "request_approval",
              isError: false,
              keys: ["approved"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord2[3]),
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_design_app",
              toolName: "design_app",
              isError: false,
            },
          ],
        },
      },
      // The recorded run chose the design through the retired Confirm prompt; the coordinator
      // now asks through choose_design's approval card, so its reply names the card.
      {
        text: extractTurnText(coord2[39]).replace(
          "choose it there",
          "choose it on the card below",
        ),
        toolCalls: [
          {
            id: "coord_choose_design",
            name: "choose_design",
            arguments: { concept: "Adaptive weather-driven" },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "weather-driven design is filed",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_read_after_design",
            name: "read_artifact",
            arguments: {},
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_choose_design",
              toolName: "choose_design",
              isError: false,
              keys: ["design", "concept"],
              contains: "Adaptive weather-driven",
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_deploy_build_plan",
            name: "deploy_writer",
            arguments: deployBuildPlanCall.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_read_after_design",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifacts", "inFlight", "preferences"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord3[5]),
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_deploy_build_plan",
              toolName: "deploy_writer",
              isError: false,
              keys: ["runId", "role", "status"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_read_build_plan",
            name: "read_artifact",
            arguments: { kind: "build_plan", part: 1 },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "written the build plan for your weather app",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        text: extractTurnText(coord3[11]),
        toolCalls: [
          {
            id: "coord_approve_build_plan",
            name: "request_approval",
            arguments: { kinds: ["build_plan"] },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_read_build_plan",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "content"],
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coord_deploy_coder",
            name: "deploy_coder",
            arguments: deployCoderCall.arguments,
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_approve_build_plan",
              toolName: "request_approval",
              isError: false,
              keys: ["approved"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord3[15]),
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_deploy_coder",
              toolName: "deploy_coder",
              isError: false,
              keys: ["runId", "role", "status"],
            },
          ],
        },
      },
      {
        text: extractTurnText(coord3[33]),
        toolCalls: [
          {
            id: "coord_instruct_coder",
            name: "instruct_coder",
            arguments: instructCoderCall.arguments,
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "Animated Weather",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
      {
        text: extractTurnText(coord3[35]),
        expect: {
          lastMessageRole: "tool",
          requiredTools: coordinatorTools,
          toolResults: [
            {
              callId: "coord_instruct_coder",
              toolName: "instruct_coder",
              isError: false,
              keys: ["runId", "role"],
            },
          ],
        },
      },
      {
        text: "The Animated Weather App is built, verified with `check-app`, and filed as version 2.",
        expect: {
          lastMessageRole: "user",
          userTextContains: "automatic app check passed again",
          requiredTools: coordinatorTools,
          toolResults: [],
        },
      },
    ],
  };

  const writer1 = await buildWriterRun(
    runsRoot,
    "writer-1",
    ZESTY_RUNS.writerConstraints,
    "constraints",
    '"artifact":"constraints"',
  );
  const writer2 = await buildWriterRun(
    runsRoot,
    "writer-2",
    ZESTY_RUNS.writerApproachesV1,
    "approaches",
    '"artifact":"approaches"',
  );
  const writer3 = await buildWriterRun(
    runsRoot,
    "writer-3",
    ZESTY_RUNS.writerApproachesV2,
    "approaches",
    '"replaces":',
  );
  const writer4 = await buildWriterRun(
    runsRoot,
    "writer-4",
    ZESTY_RUNS.writerRequirements,
    "product-requirements",
    '"artifact":"product_requirements"',
  );
  const writer5 = await buildWriterRun(
    runsRoot,
    "writer-5",
    ZESTY_RUNS.writerBuildPlan,
    "build-plan",
    '"artifact":"build_plan"',
  );

  const reviewerRun: RunSpec = {
    runKey: "reviewer-1",
    role: "reviewer",
    stage: "documents",
    sourceRunId: "run_2c1986a2c8dee7a4d192add5f8c5e7b9",
    exchanges: [
      {
        text: "Engineering review of constraints: All constraints (C-1 through C-14) and non-goals (NG-1 through NG-8) align with the Problem Brief's Open-Meteo proxy, 60fps canvas animation, WCAG AA contrast, and browser-only persistence requirements. Ready for approval.",
        expect: {
          lastMessageRole: "user",
          userTextContains: '"artifact":"engineering_review"',
          requiredTools: ["mail_search", "mail_reply", "mail_send"],
          toolResults: [],
        },
      },
    ],
  };

  const { stylesCss, indexHtml, designMd } =
    await reconstructDesignFiles(runsRoot);
  const designerFinalText =
    extractTurnText(designTurns.filter((t) => t.role === "assistant").at(-1)) ||
    "The weather-driven design is filed as this concept's option.";
  const designerTools = [
    "write_file",
    "read_file",
    "edit_file",
    "grep",
    "check_design",
    "file_design_option",
    "mail_reply",
    "mail_search",
  ];

  const designerRun: RunSpec = {
    runKey: "designer-1",
    role: "designer",
    stage: "design",
    sourceRunId: "run_58cf9e8d726377fd10cf3b6d4c751bbc",
    exchanges: [
      {
        toolCalls: [
          {
            id: "des_write_css",
            name: "write_file",
            arguments: {
              path: ".builder/designs/styles.css",
              content: stylesCss,
            },
          },
          {
            id: "des_write_html",
            name: "write_file",
            arguments: {
              path: ".builder/designs/index.html",
              content: indexHtml,
            },
          },
          {
            id: "des_write_doc",
            name: "write_file",
            arguments: {
              path: ".builder/DESIGN.md",
              content: designMd,
            },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "Adaptive weather-driven",
          requiredTools: designerTools,
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: "des_check",
            name: "check_design",
            arguments: {},
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: designerTools,
          toolResults: [
            {
              callId: "des_write_css",
              toolName: "write_file",
              isError: false,
            },
            {
              callId: "des_write_html",
              toolName: "write_file",
              isError: false,
            },
            {
              callId: "des_write_doc",
              toolName: "write_file",
              isError: false,
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "des_file_option",
            name: "file_design_option",
            arguments: {},
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: designerTools,
          toolResults: [
            {
              callId: "des_check",
              toolName: "check_design",
              isError: false,
              contains: "check passed",
            },
          ],
        },
      },
      {
        text: designerFinalText,
        expect: {
          lastMessageRole: "tool",
          requiredTools: designerTools,
          toolResults: [
            {
              callId: "des_file_option",
              toolName: "file_design_option",
              isError: false,
              keys: ["artifactId", "kind", "version", "sha256"],
            },
          ],
        },
      },
    ],
  };

  const appFiles = await loadWeatherAppSourceFiles(liveAppWorkspace);
  // The app was recorded before a finished app shipped a user manual; the check now asks for one,
  // so the coder writes it with the rest.
  if (!appFiles.some((f) => f.path === USER_MANUAL_PATH))
    appFiles.push({
      path: USER_MANUAL_PATH,
      content: await readFile(USER_MANUAL_SOURCE, "utf8"),
    });
  const acceptanceFile = appFiles.find((f) => f.path === "ACCEPTANCE.md");
  if (!acceptanceFile) {
    throw new Error("Expected ACCEPTANCE.md in liveAppWorkspace");
  }
  const coderFinalText =
    extractTurnText(coderTurns.filter((t) => t.role === "assistant").at(-1)) ||
    "The automatic app check passed again just now.";
  const coderTools = [
    "read_artifact",
    "write_file",
    "edit_file",
    "read_file",
    "run_shell",
    "app_status",
    "install_packages",
    "mail_reply",
    "mail_search",
  ];

  const writeCalls: ToolCallSpec[] = appFiles.map((file, idx) => ({
    id: `coder_write_${idx}`,
    name: "write_file",
    arguments: {
      path: file.path,
      content: file.content,
    },
  }));

  const coderRun: RunSpec = {
    runKey: "coder-1",
    role: "coder",
    stage: "build",
    sourceRunId: "run_970c695116933ed8147c26bcad9a0a65",
    exchanges: [
      {
        toolCalls: [
          {
            id: "coder_read_design",
            name: "read_artifact",
            arguments: { kind: "design" },
          },
          ...writeCalls,
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: ".inputs/build-plan.md",
          requiredTools: coderTools,
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: "coder_check_v1",
            name: "run_shell",
            arguments: { command: "check-app" },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coderTools,
          toolResults: [
            {
              callId: "coder_read_design",
              toolName: "read_artifact",
              isError: false,
              keys: ["artifactId", "kind", "version", "content"],
            },
            ...writeCalls.map((c) => ({
              callId: c.id,
              toolName: "write_file",
              isError: false,
            })),
          ],
        },
      },
      {
        text: "Animated Weather v1 is built, verified with `check-app`, and filed.",
        expect: {
          lastMessageRole: "tool",
          requiredTools: coderTools,
          toolResults: [
            {
              callId: "coder_check_v1",
              toolName: "run_shell",
              isError: false,
              contains: "The app is filed as version 1.",
            },
          ],
        },
      },
      {
        toolCalls: [
          {
            id: "coder_write_acceptance_v2",
            name: "write_file",
            arguments: {
              path: "ACCEPTANCE.md",
              content: `${acceptanceFile.content.trimEnd()}\n\n- Verified v2 acceptance check.\n`,
            },
          },
        ],
        expect: {
          lastMessageRole: "user",
          userTextContains: "Please report where you are",
          requiredTools: coderTools,
          toolResults: [],
        },
      },
      {
        toolCalls: [
          {
            id: "coder_check_v2",
            name: "run_shell",
            arguments: { command: "check-app" },
          },
        ],
        expect: {
          lastMessageRole: "tool",
          requiredTools: coderTools,
          toolResults: [
            {
              callId: "coder_write_acceptance_v2",
              toolName: "write_file",
              isError: false,
            },
          ],
        },
      },
      {
        text: coderFinalText,
        expect: {
          lastMessageRole: "tool",
          requiredTools: coderTools,
          toolResults: [
            {
              callId: "coder_check_v2",
              toolName: "run_shell",
              isError: false,
              contains: "The app is filed as version 2.",
            },
          ],
        },
      },
    ],
  };

  const allRuns: readonly RunSpec[] = [
    coordinatorRun,
    writer1,
    reviewerRun,
    writer2,
    writer3,
    writer4,
    designerRun,
    writer5,
    coderRun,
  ];

  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });

  const manifest: ScenarioManifest = {
    scenario: "animated-weather-app",
    recordedFromCommit: "d6c6b46",
    runs: allRuns.map((r) => ({
      runKey: r.runKey,
      role: r.role,
      stage: r.stage,
      sourceRunId: r.sourceRunId,
      exchangeCount: r.exchanges.length,
    })),
  };

  await writeFile(
    join(fixtureDir, "scenario.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  for (const run of allRuns) {
    const runDir = join(fixtureDir, "runs", run.runKey);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "session.json"),
      `${JSON.stringify(
        {
          runKey: run.runKey,
          role: run.role,
          stage: run.stage,
          sourceRunId: run.sourceRunId,
          exchangeCount: run.exchanges.length,
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(runDir, "key.json"),
      `${JSON.stringify(
        {
          role: run.role,
          stage: run.stage,
          sourceRunId: run.sourceRunId,
        },
        null,
        2,
      )}\n`,
    );
    for (let i = 0; i < run.exchanges.length; i += 1) {
      const ex = run.exchanges[i]!;
      if (!ex.text?.trim() && !ex.toolCalls?.length) {
        throw new Error(
          `Empty exchange ${i} in run ${run.runKey} (neither text nor toolCalls)`,
        );
      }
      const exDir = join(runDir, "exchanges", String(i));
      await mkdir(exDir, { recursive: true });
      const sse = formatOpenAISseResponse({
        ...(ex.text ? { text: ex.text } : {}),
        ...(ex.toolCalls ? { toolCalls: ex.toolCalls } : {}),
      });
      await writeFile(join(exDir, "response.sse"), sse);
      await writeFile(
        join(exDir, "response-headers.json"),
        `${JSON.stringify(
          { "content-type": "text/event-stream; charset=utf-8" },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(exDir, "expect.json"),
        `${JSON.stringify(ex.expect, null, 2)}\n`,
      );
    }
  }

  const fmt = Bun.spawn(["bun", "fmt", "--no-script", fixtureDir], {
    cwd: REPO_ROOT,
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await fmt.exited) !== 0) {
    throw new Error(
      `Failed to format ${fixtureDir}: ${await new Response(fmt.stderr).text()}`,
    );
  }

  const totalBytes = await directoryBytes(fixtureDir);
  if (totalBytes > MAX_SCENARIO_BYTES) {
    throw new Error(
      `Fixture size ${totalBytes} bytes exceeds 2 MB cap (${MAX_SCENARIO_BYTES} bytes)`,
    );
  }
  return { fixtureDir, totalBytes };
}

if (import.meta.main) {
  const { fixtureDir, totalBytes } = await extractWeatherAppFixture();
  console.log(
    `Extracted Weather App fixture to ${fixtureDir} (${(totalBytes / 1024).toFixed(1)} KB)`,
  );
}
