import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyRole,
  formatOpenAISseResponse,
  loadScenarioBundle,
  startRecordedModelServer,
  writeScenarioFixture,
  type ExchangeExpectation,
} from "./recorded-model.ts";

async function writeBundle(
  root: string,
  exchanges: { sse: string; expect: ExchangeExpectation }[],
): Promise<void> {
  await writeScenarioFixture(
    root,
    { scenario: "unit-bundle", recordedFromCommit: "d6c6b46" },
    [
      {
        runKey: "writer-1",
        role: "writer",
        stage: "documents",
        sourceRunId: "run_test",
        exchanges,
      },
    ],
  );
}

describe("recorded-model server", () => {
  test("validates the committed pipeline fixture bundle with ArkType schemas", async () => {
    const fixtureDir = join(
      import.meta.dir,
      "..",
      "..",
      "fixtures",
      "pipeline",
    );
    const bundle = await loadScenarioBundle(fixtureDir);
    expect(bundle.manifest.scenario).toBe("animated-weather-app");
    expect(bundle.runs.length).toBe(bundle.manifest.runs.length);
  });

  test("serves recorded SSE turns and substitutes bound values from tool results", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recorded-model-test-"));
    try {
      await writeBundle(dir, [
        {
          sse: formatOpenAISseResponse({
            toolCalls: [
              {
                id: "call_1",
                name: "write_artifact",
                arguments: {
                  kind: "constraints",
                  title: "Constraints: Animated Weather App",
                  content: "# Constraints",
                },
              },
            ],
          }),
          expect: {
            lastMessageRole: "user",
            userTextContains: "Write the constraints",
            requiredTools: ["write_artifact", "read_skill"],
            toolResults: [],
          },
        },
        {
          sse: formatOpenAISseResponse({
            text: "Filed version {{bind:constraints.version}} ({{bind:constraints.artifactId}}).",
          }),
          expect: {
            lastMessageRole: "tool",
            requiredTools: ["write_artifact", "read_skill"],
            toolResults: [
              {
                callId: "call_1",
                toolName: "write_artifact",
                isError: false,
                keys: ["artifactId", "version", "sha256"],
                bind: {
                  "constraints.artifactId": "artifactId",
                  "constraints.version": "version",
                },
              },
            ],
          },
        },
      ]);

      const server = await startRecordedModelServer(dir);
      try {
        const tools = [
          { type: "function", function: { name: "write_artifact" } },
          { type: "function", function: { name: "read_skill" } },
        ];
        const first = await fetch(`${server.url}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "recorded-replay",
            messages: [{ role: "user", content: "Write the constraints" }],
            tools,
          }),
        });
        expect(first.status).toBe(200);
        const firstSse = await first.text();
        expect(firstSse).toContain("write_artifact");

        const second = await fetch(`${server.url}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "recorded-replay",
            messages: [
              { role: "user", content: "Write the constraints" },
              {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    function: { name: "write_artifact", arguments: "{}" },
                  },
                ],
              },
              {
                role: "tool",
                tool_call_id: "call_1",
                content: JSON.stringify({
                  artifactId: "art_live_123",
                  version: 1,
                  sha256: "abc",
                }),
              },
            ],
            tools,
          }),
        });
        expect(second.status).toBe(200);
        const secondSse = await second.text();
        expect(secondSse).toContain("Filed version 1 (art_live_123).");

        server.assertClean();
      } finally {
        await server.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fails immediately with scenario, stage, run, exchange and re-record step on divergence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recorded-model-fail-"));
    try {
      await writeBundle(dir, [
        {
          sse: formatOpenAISseResponse({ text: "done" }),
          expect: {
            lastMessageRole: "tool",
            requiredTools: ["write_artifact"],
            toolResults: [
              {
                callId: "call_1",
                toolName: "write_artifact",
                isError: false,
                keys: ["artifactId", "version"],
              },
            ],
          },
        },
      ]);

      const server = await startRecordedModelServer(dir);
      try {
        const res = await fetch(`${server.url}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "recorded-replay",
            messages: [
              {
                role: "tool",
                tool_call_id: "call_1",
                content: "<error>\nrefused\n</error>",
              },
            ],
            tools: [{ type: "function", function: { name: "write_artifact" } }],
          }),
        });
        expect(res.status).toBe(500);
        expect(() => server.assertClean()).toThrow(/scenario: unit-bundle/);
        expect(() => server.assertClean()).toThrow(/stage: documents/);
        expect(() => server.assertClean()).toThrow(/run: writer-1/);
        expect(() => server.assertClean()).toThrow(/exchange: 0/);
        expect(() => server.assertClean()).toThrow(
          /re-record: bun --conditions=intx-src test\/e2e\/support\/extract\.ts/,
        );
      } finally {
        await server.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("classifies presenter and other agent roles from offered tools", () => {
    const baseReq = {
      model: "recorded-replay",
      messages: [{ role: "user", content: "Build the deck" }],
    };
    expect(
      classifyRole(
        baseReq,
        new Set(["write_deck", "check_deck", "file_package"]),
      ),
    ).toBe("presenter");
    expect(classifyRole(baseReq, new Set(["file_package"]))).toBe("presenter");
    expect(
      classifyRole(
        baseReq,
        new Set(["deploy_writer", "deploy_presenter", "request_approval"]),
      ),
    ).toBe("coordinator");
    expect(
      classifyRole(baseReq, new Set(["check_design", "file_design_option"])),
    ).toBe("designer");
    expect(
      classifyRole(baseReq, new Set(["app_status", "install_packages"])),
    ).toBe("coder");
    expect(
      classifyRole(baseReq, new Set(["write_artifact", "read_skill"])),
    ).toBe("writer");
    expect(
      classifyRole(
        {
          model: "recorded-replay",
          messages: [
            { role: "system", content: "You are a document reviewer." },
            { role: "user", content: "Review this." },
          ],
        },
        new Set(["mail_reply"]),
      ),
    ).toBe("reviewer");
  });
});
