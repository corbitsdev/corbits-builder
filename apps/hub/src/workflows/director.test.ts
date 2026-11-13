import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCapabilities } from "@intx/inference";
import type {
  ConversationTurn,
  InferenceError,
  ReactorAction,
  ReactorDirector,
  ReactorInboundEvent,
  ReactorState,
  RetryPolicy,
  ToolCall,
} from "@intx/types/runtime";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  designStarterFiles,
  designThemes,
} from "@corbits-builder/designer/skills" with { type: "macro" };
import { createDesignTools } from "../artifacts/design-tools.ts";
import {
  CHECK_DESIGN_TOOL,
  createDesignCheck,
} from "../builds/design-check.ts";
import { REPETITION_ABORT } from "../inference/repetition.ts";
import { trimHistory } from "./compaction.ts";
import { compactingDirector } from "./director.ts";

const director = (
  replyOnFailure: boolean,
  timeouts: { totalTimeoutMs?: number } = {},
) =>
  compactingDirector("@corbits-builder/test").factory(
    { contextWindow: 200_000, compactAt: 0.8, replyOnFailure, timeouts },
    {} as never,
    { systemPrompt: "", toolDefinitions: [], compactorNames: [] },
  ) as ReactorDirector;

const state: ReactorState = {
  turns: [],
  activeForks: [],
  pendingOperations: [],
  activeGates: [],
  tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
  lastCycleUsage: null,
  lastCycleSource: null,
  sessionId: "session",
};

const decide = async (subject: ReactorDirector, event: ReactorInboundEvent) => {
  const actions = await subject.decide(event, state, createCapabilities());
  return (Array.isArray(actions) ? actions : [actions]) as ReactorAction[];
};

const failed = (error: InferenceError): ReactorInboundEvent => ({
  type: "inference.error",
  error,
  partial: { text: "" },
});

const retryPolicy = (actions: ReactorAction[]): RetryPolicy => {
  const infer = actions.find((action) => action.type === "infer");
  const policy =
    infer?.type === "infer" ? infer.options?.retryPolicy : undefined;
  if (!policy) throw new Error("infer_without_retry_policy");
  return policy;
};

test("every inference carries the source's total timeout, and none without one", async () => {
  const events: ReactorInboundEvent[] = [
    {
      type: "message.received",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    } as never,
    failed({ category: "protocol_mismatch", message: `${REPETITION_ABORT} x` }),
  ];
  for (const event of events) {
    const timed = (
      await decide(director(false, { totalTimeoutMs: 900_000 }), event)
    ).filter((action) => action.type === "infer");
    const untimed = (await decide(director(false), event)).filter(
      (action) => action.type === "infer",
    );
    expect(timed.length).toBeGreaterThan(0);
    expect(untimed.length).toBeGreaterThan(0);
    for (const action of timed)
      expect(action.options?.totalTimeoutMs).toBe(900_000);
    for (const action of untimed)
      expect(action.options).not.toHaveProperty("totalTimeoutMs");
  }
});

const overloaded: InferenceError = {
  category: "retryable",
  message: "overloaded",
  statusCode: 529,
};

test("every inference retries a busy model on a bounded backoff", async () => {
  const subject = director(false);
  const policies = [
    retryPolicy(
      await decide(subject, {
        type: "reactor.gate.cleared",
        gateId: "gate",
        reason: "resolved",
      }),
    ),
    retryPolicy(
      await decide(
        subject,
        failed({
          category: "protocol_mismatch",
          message: `${REPETITION_ABORT} repeated`,
        }),
      ),
    ),
  ];
  const timeout: InferenceError = { category: "timeout", message: "stall" };
  const quota = (retryAfterMs: number): InferenceError => ({
    category: "quota_exhausted",
    message: "rate limited",
    retryAfterMs,
  });
  for (const policy of policies) {
    const decision = (error: InferenceError, attempt: number, elapsedMs = 0) =>
      policy({ error, attempt, elapsedMs });
    expect(
      await Promise.all([
        decision(overloaded, 1),
        decision(overloaded, 2),
        decision(overloaded, 3),
        decision(overloaded, 4),
        decision(overloaded, 2, 6 * 60_000),
        decision(timeout, 1, 10 * 60_000),
        decision(timeout, 2),
        decision(quota(45_000), 1),
        decision(quota(90_000), 1),
        decision({ category: "fatal", message: "bad request" }, 1),
      ]),
    ).toEqual([
      { kind: "retry", delayMs: 2_000 },
      { kind: "retry", delayMs: 8_000 },
      { kind: "retry", delayMs: 30_000 },
      { kind: "abort" },
      { kind: "abort" },
      { kind: "retry", delayMs: 2_000 },
      { kind: "abort" },
      { kind: "retry", delayMs: 45_000 },
      { kind: "abort" },
      { kind: "abort" },
    ]);
  }
});

test("a model error that outlasts the retries fails a specialist and is the coordinator's reply", async () => {
  await expect(decide(director(false), failed(overloaded))).rejects.toThrow(
    "model_unavailable",
  );
  const reply = (await decide(director(true), failed(overloaded))).find(
    (action) => action.type === "reply",
  );
  expect(reply?.type === "reply" ? reply.content : "").toContain("overloaded");
});

test("a turn with two calls that wait on the person ends with a result for each", async () => {
  const subject = compactingDirector("@corbits-builder/test").factory(
    {
      contextWindow: 200_000,
      compactAt: 0.8,
      asks: ["install_packages"],
      timeouts: {},
    },
    {} as never,
    { systemPrompt: "", toolDefinitions: [], compactorNames: [] },
  ) as ReactorDirector;
  const installHono = {
    id: "a",
    name: "install_packages",
    arguments: { packages: ["hono"] },
  };
  const installZod = {
    id: "b",
    name: "install_packages",
    arguments: { packages: ["zod"] },
  };
  const report = { id: "c", name: "report_values", arguments: {} };
  const turnOf = (calls: ToolCall[]) => ({
    role: "assistant" as const,
    model: "gpt-5",
    content: calls.map((call) => ({
      type: "tool_call" as const,
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
    timestamp: 1,
  });
  const inferred = (turn: ReturnType<typeof turnOf>): ReactorInboundEvent => ({
    type: "inference.done",
    turn,
    usage: state.tokenUsage,
    source: { sourceId: "openai", provider: "openai", model: "gpt-5" },
  });
  // A turn with at most one call that asks runs all its calls together, as before.
  const single = turnOf([installHono, report]);
  const together = await subject.decide(
    inferred(single),
    { ...state, turns: [single] },
    createCapabilities(),
  );
  expect(
    (Array.isArray(together) ? together : [together]).flatMap((action) =>
      action.type === "execute_tools" ? action.calls : [],
    ),
  ).toEqual([installHono, report]);

  const turn = turnOf([installHono, installZod, report]);
  const turns: ConversationTurn[] = [
    {
      role: "user",
      content: [{ type: "text", text: "Build it." }],
      timestamp: 0,
    },
    turn,
  ];
  const decideOn = async (event: ReactorInboundEvent) => {
    const actions = await subject.decide(
      event,
      { ...state, turns },
      createCapabilities(),
    );
    return (Array.isArray(actions) ? actions : [actions]) as ReactorAction[];
  };
  const dispatched = (actions: ReactorAction[]) =>
    actions.flatMap((action) =>
      action.type === "execute_tools" ? action.calls : [],
    );
  const answer = (id: string) => {
    turns.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: id,
          content: [{ type: "text", text: "ok" }],
        },
      ],
      timestamp: 2,
    });
    return decideOn({
      type: "tool.done",
      result: { callId: id, content: "ok" },
    });
  };

  // Each install parks the run on its own approval, so each is dispatched alone and the next only
  // once the one before it has its result.
  expect(dispatched(await decideOn(inferred(turn)))).toEqual([installHono]);
  expect(
    dispatched(
      await decideOn({ type: "resume.execute_tools", calls: [installHono] }),
    ),
  ).toEqual([installHono]);
  expect(dispatched(await answer("a"))).toEqual([installZod]);
  expect(
    dispatched(
      await decideOn({ type: "resume.execute_tools", calls: [installZod] }),
    ),
  ).toEqual([installZod]);
  expect(dispatched(await answer("b"))).toEqual([report]);
  const last = await answer("c");
  expect(dispatched(last)).toEqual([]);
  expect(last.some((action) => action.type === "infer")).toBe(true);
});

test("designer director holds replies until the latest edits pass check_design and file a design option", async () => {
  const subject = compactingDirector("@corbits-builder/designer-test").factory(
    {
      contextWindow: 200_000,
      compactAt: 0.8,
      checkBeforeDone: true,
      fileBeforeDone: true,
    },
    {} as never,
    { systemPrompt: "Base prompt.", toolDefinitions: [], compactorNames: [] },
  ) as ReactorDirector;

  const replyTurn = {
    role: "assistant" as const,
    model: "claude-sonnet-4-6",
    content: [{ type: "text" as const, text: "Done." }],
    timestamp: 1,
  };
  const decideWithTurns = async (
    turns: ConversationTurn[],
    event: ReactorInboundEvent,
  ) => {
    const actions = await subject.decide(
      event,
      { ...state, turns },
      createCapabilities(),
    );
    return (Array.isArray(actions) ? actions : [actions]) as ReactorAction[];
  };

  // 1. Reply before any check or filing after write_file -> held by checkBeforeDone.
  const uncheckedTurns: ConversationTurn[] = [
    {
      role: "user",
      content: [{ type: "text", text: "Design the app." }],
      timestamp: 0,
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call-1",
          name: "write_file",
          arguments: { path: "designs/index.html", content: "<h1>App</h1>" },
        },
      ],
      timestamp: 1,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "call-1",
          content: [{ type: "text", text: "wrote designs/index.html" }],
        },
      ],
      timestamp: 2,
    },
    replyTurn,
  ];
  const cycleSource = {
    sourceId: "anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  };
  const heldUnchecked = await decideWithTurns(uncheckedTurns, {
    type: "inference.done",
    turn: replyTurn,
    usage: state.tokenUsage,
    source: cycleSource,
  });
  const note1 = heldUnchecked.find((action) => action.type === "compact");
  expect(note1?.type === "compact" ? note1.reason : "").toContain(
    "Files changed after the last passing check, so the work is not done yet.",
  );

  // 2. Reply when no files changed yet and no design option was filed -> held by fileBeforeDone.
  const unfiledTurns: ConversationTurn[] = [
    {
      role: "user",
      content: [{ type: "text", text: "Design the app." }],
      timestamp: 0,
    },
    replyTurn,
  ];
  const heldUnfiled = await decideWithTurns(unfiledTurns, {
    type: "inference.done",
    turn: replyTurn,
    usage: state.tokenUsage,
    source: cycleSource,
  });
  const note2 = heldUnfiled.find((action) => action.type === "compact");
  expect(note2?.type === "compact" ? note2.reason : "").toContain(
    "The design option is not filed yet; check_design or file_design_option files it.",
  );

  // 3. Passing check_design that auto-filed the design option -> reply is accepted without extra turn.
  const autoFiledTurns: ConversationTurn[] = [
    ...uncheckedTurns.slice(0, -1),
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call-check",
          name: CHECK_DESIGN_TOOL,
          arguments: {},
        },
      ],
      timestamp: 3,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "call-check",
          content: [
            {
              type: "text",
              text: 'check passed: served .builder/designs\nFiled design_option: {"artifactId":"design-1","kind":"design_option","version":1,"sha256":"a"}',
            },
          ],
          detail: { checkPassed: true, filed: true },
        },
      ],
      timestamp: 4,
    },
    replyTurn,
  ];
  const accepted = await decideWithTurns(autoFiledTurns, {
    type: "inference.done",
    turn: replyTurn,
    usage: state.tokenUsage,
    source: cycleSource,
  });
  expect(accepted.some((action) => action.type === "reply")).toBe(true);
});

test("coder director takes a check-app verdict from the result's detail after trimming drops its text", async () => {
  const subject = compactingDirector("@corbits-builder/coder-test").factory(
    { contextWindow: 200_000, compactAt: 0.8, checkBeforeDone: true },
    {} as never,
    { systemPrompt: "", toolDefinitions: [], compactorNames: [] },
  ) as ReactorDirector;
  const replyTurn = {
    role: "assistant" as const,
    model: "gpt-5",
    content: [{ type: "text" as const, text: "Done." }],
    timestamp: 5,
  };
  const checked = (
    output: string,
    checkPassed: boolean,
  ): ConversationTurn[] => [
    {
      role: "user",
      content: [{ type: "text", text: "Build the app." }],
      timestamp: 0,
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call-write",
          name: "write_file",
          arguments: { path: "src/App.tsx", content: "export {}" },
        },
      ],
      timestamp: 1,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "call-write",
          content: [{ type: "text", text: "wrote src/App.tsx" }],
        },
      ],
      timestamp: 2,
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call-check",
          name: "run_shell",
          arguments: { command: "check-app" },
        },
      ],
      timestamp: 3,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "call-check",
          content: [{ type: "text", text: output }],
          detail: { checkPassed },
        },
      ],
      timestamp: 4,
    },
  ];
  const decideTrimmed = async (output: string, checkPassed: boolean) => {
    const { output: turns } = await trimHistory(1).apply(
      checked(output, checkPassed),
      { state, trigger: "context" },
    );
    const result = turns
      .flatMap((turn) => turn.content)
      .find(
        (block) =>
          block.type === "tool_result" && block.callId === "call-check",
      );
    expect(JSON.stringify(result)).not.toContain(output.slice(0, 20));
    const actions = await subject.decide(
      {
        type: "inference.done",
        turn: replyTurn,
        usage: state.tokenUsage,
        source: { sourceId: "openai", provider: "openai", model: "gpt-5" },
      },
      { ...state, turns: [...turns, replyTurn] },
      createCapabilities(),
    );
    return (Array.isArray(actions) ? actions : [actions]) as ReactorAction[];
  };
  const checklist = "\n✓ every page opened with no errors".repeat(40);

  const passed = await decideTrimmed(
    `check passed: built, started, and opened / at 1280 and 390 px with no errors${checklist}`,
    true,
  );
  expect(passed.some((action) => action.type === "reply")).toBe(true);

  const failed = await decideTrimmed(
    `check failed: 1 problem(s) across 1 page(s)${checklist}`,
    false,
  );
  expect(failed.some((action) => action.type === "reply")).toBe(false);
  expect(failed.some((action) => action.type === "compact")).toBe(true);
});

test("coder director never holds a reply that follows a refused access", async () => {
  const subject = () =>
    compactingDirector("@corbits-builder/coder-test").factory(
      {
        contextWindow: 200_000,
        compactAt: 0.8,
        checkBeforeDone: true,
      },
      {} as never,
      { systemPrompt: "", toolDefinitions: [], compactorNames: [] },
    ) as ReactorDirector;
  const replyTurn = {
    role: "assistant" as const,
    model: "gpt-5",
    content: [{ type: "text" as const, text: "Done." }],
    timestamp: 5,
  };
  const call = (id: string, name: string, args: Record<string, unknown>) => ({
    role: "assistant" as const,
    content: [{ type: "tool_call" as const, id, name, arguments: args }],
    timestamp: 1,
  });
  const result = (callId: string, detail?: unknown) => ({
    role: "user" as const,
    content: [
      {
        type: "tool_result" as const,
        callId,
        content: [{ type: "text" as const, text: "ok" }],
        ...(detail === undefined ? {} : { detail }),
      },
    ],
    timestamp: 2,
  });
  const decideOn = async (
    director: ReactorDirector,
    turns: ConversationTurn[],
    event: ReactorInboundEvent,
  ) => {
    const actions = await director.decide(
      event,
      { ...state, turns: [...turns, replyTurn] },
      createCapabilities(),
    );
    return (Array.isArray(actions) ? actions : [actions]) as ReactorAction[];
  };
  const replied: ReactorInboundEvent = {
    type: "inference.done",
    turn: replyTurn,
    usage: state.tokenUsage,
    source: { sourceId: "openai", provider: "openai", model: "gpt-5" },
  };
  // A held reply's note, as its compaction carries it, or undefined once it goes out.
  const heldFor = async (
    director: ReactorDirector,
    turns: ConversationTurn[],
  ) => {
    const actions = await decideOn(director, turns, replied);
    if (actions.some((action) => action.type === "reply")) return undefined;
    const compact = actions.find((action) => action.type === "compact");
    return compact?.type === "compact" ? compact.reason : "";
  };

  const editedAfter: ConversationTurn[] = [
    {
      role: "user",
      content: [{ type: "text", text: "Build the app." }],
      timestamp: 0,
    },
    call("check", "run_shell", { command: "check-app" }),
    result("check", { checkPassed: true }),
    call("write", "write_file", { path: "src/App.tsx", content: "" }),
    result("write"),
  ];
  // A refused access ends the job, so its reply goes out whatever would hold it.
  const refused = [
    ...editedAfter,
    call("read", "read_artifact", {}),
    result("read", { accessRefused: true }),
  ];
  expect(await heldFor(subject(), refused)).toBeUndefined();
  // One the agent already wrote past releases nothing later.
  const wrotePast = [
    ...refused,
    call("write2", "write_file", { path: "src/App.tsx", content: "" }),
    result("write2"),
  ];
  expect(await heldFor(subject(), wrotePast)).toContain(
    "Files changed after the last passing check",
  );
});

test("check_design validates DESIGN.md and .dark in styles.css and auto-files the design option on pass", async () => {
  const starter = designStarterFiles();
  const modernSleek = designThemes()["modern-sleek"]!;
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "sb-design-autocheck-")),
  );
  const check = createDesignCheck(workspace, async () => ({
    exitCode: 0,
    output:
      "check passed: served .builder/designs and opened /, /#/home at 1280 and 390 px with no errors",
  }));
  try {
    for (const [path, text] of Object.entries(starter)) {
      const target = join(workspace, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    const deployment = {
      source: {
        kind: "asset" as const,
        assetId: "asset",
        package: { format: "tarball" as const },
      },
      entry: "entry",
      pin: "@corbits-builder/designer@1.0.0",
      sourceOfferingIds: ["offering"],
      defaultSourceOfferingId: "offering",
    };
    let postCount = 0;
    const fetch = async (path: string, init: RequestInit) => {
      if (path === "/api/workflow-project-scope")
        return Response.json({
          tenantId: "tenant",
          projectId: "project",
          domain: "example.invalid",
          role: "designer",
          workflows: {
            "writer-product-requirements": deployment,
            "writer-build-plan": deployment,
            "writer-document": deployment,
            reviewer: deployment,
            coder: deployment,
            designer: deployment,
          },
          openNetwork: false,
          build: {
            assetDirectory: "/assets",
            browserCli: "/browser",
            childPath: "/child",
            dependencyRoots: ["/deps"],
            ripgrepPath: "/rg",
            runtimeVersion: "1.0.0",
          },
        });
      if (path === "/api/tenants/tenant/projects/project/artifacts") {
        postCount += 1;
        const body = JSON.parse(String(init.body)) as { title: string };
        return Response.json({
          artifact: {
            artifactId: "design-1",
            kind: "design_option",
            title: body.title,
            version: postCount,
            sha256: "a".repeat(64),
          },
        });
      }
      return Response.json({ code: "unexpected_route" }, { status: 404 });
    };
    const capabilities = {
      resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
    } as unknown as RuntimeCapabilities;
    const tools = createDesignTools("designer")({
      toolCwd: workspace,
      capabilities,
    } as never);
    const signal = new AbortController().signal;

    // 1. Starter DESIGN.md with template placeholders fails check_design even when check-app exits 0.
    const placeholderCheck = await check.current(signal);
    expect(placeholderCheck.passed).toBe(false);
    expect(placeholderCheck.checklist).toContain(
      "check failed: invalid_design: DESIGN.md still has",
    );
    expect(postCount).toBe(0);

    // 2. Valid DESIGN.md but styles.css missing .dark fails check_design with the exact token error.
    await writeFile(
      join(workspace, ".builder", "DESIGN.md"),
      modernSleek["DESIGN.md"]!,
    );
    const stylesWithoutDark = modernSleek["designs/styles.css"]!.replace(
      /\.dark\s*\{[^}]*\}/,
      "",
    );
    await writeFile(
      join(workspace, ".builder", "designs", "styles.css"),
      stylesWithoutDark,
    );
    const missingDarkCheck = await check.current(signal);
    expect(missingDarkCheck.passed).toBe(false);
    expect(missingDarkCheck.checklist).toContain(
      "check failed: invalid_design: styles.css has no .dark rule",
    );
    expect(postCount).toBe(0);

    // 3. Restoring valid styles.css makes check_design pass AND auto-file the design option.
    await writeFile(
      join(workspace, ".builder", "designs", "styles.css"),
      modernSleek["designs/styles.css"]!,
    );
    const passedCheck = await check.current(signal);
    expect(passedCheck.passed).toBe(true);
    expect(passedCheck.checklist).toContain("check passed:");
    expect(passedCheck.checklist).toContain("Filed design_option:");
    expect(postCount).toBe(1);

    // 4. Calling file_design_option on the same unchanged files reuses the filed receipt without a second POST.
    const filedResult = await tools.run(
      { id: "call-file", name: "file_design_option", arguments: {} },
      signal,
    );
    expect(filedResult.isError).toBeUndefined();
    expect(postCount).toBe(1);
    expect(JSON.parse(String(filedResult.content))).toMatchObject({
      artifactId: "design-1",
      kind: "design_option",
      version: 1,
    });
  } finally {
    check.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
});
