import { describe, expect, test } from "bun:test";
import "./plugin-roles.testing.ts";
import { renderToStaticMarkup } from "react-dom/server";
import {
  filedDispatches,
  noteDispatch,
  runDispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import { RoomThread } from "./transcript.tsx";
import { workUnitStanding } from "./work-unit-step.model.ts";

const room: DispatchRoom = {
  artifacts: [
    {
      artifactId: "11111111-1111-4111-8111-111111111111",
      kind: "product_requirements",
      title: "Todo Requirements",
      version: 1,
      sha256: "0".repeat(64),
      filedAt: new Date(20).toISOString(),
    },
  ],
  inFlight: [],
  failed: [],
  seen: new Map(),
};

describe("conversation map", () => {
  test("a filed document and an answered approval follow the person's message", () => {
    const writer = runDispatch({
      runId: "run-writer",
      role: "writer",
      startedAt: new Date(10).toISOString(),
      status: "running",
      state: "waiting",
    });
    noteDispatch(room, writer);
    const html = renderToStaticMarkup(
      <RoomThread
        standing={(unit) => workUnitStanding(unit, room)}
        turns={[{ role: "person", text: "Make a todo app", at: 1 }]}
        runs={filedDispatches(room, [], [{ at: 10, dispatch: writer }])}
        approvals={[
          {
            approvalId: "appr-1",
            toolName: "run_shell",
            subject: "bun run build",
            at: 30,
            outcome: { status: "approved" },
          },
        ]}
      />,
    );
    const ticks = [
      ...html.matchAll(
        /data-slot="conversation-map-tick" data-turn-id="[^"]*"(?: data-visible="")? aria-label="([^"]*)"/g,
      ),
    ].map((match) => match[1]);
    expect(ticks).toEqual([
      "Go to: Make a todo app",
      "Go to: Requirements v1",
      "Go to: Let the specialist use run shell on bun run build? · Answered",
    ]);
  });

  test("each piece of work from one coordinator message has its own entry, on its own row", () => {
    const ended: DispatchRoom = {
      artifacts: [],
      inFlight: [],
      failed: [],
      seen: new Map(),
      ended: new Map([
        ["run-calm", { status: "completed" }],
        ["run-bold", { status: "completed" }],
      ]),
    };
    const html = renderToStaticMarkup(
      <RoomThread
        standing={(unit) => workUnitStanding(unit, ended)}
        results={
          new Map([
            [
              "call-mockups",
              {
                content: JSON.stringify({
                  runs: [
                    { concept: "Calm", runId: "run-calm" },
                    { concept: "Bold", runId: "run-bold" },
                  ],
                }),
                isError: false,
              },
            ],
          ])
        }
        turns={[
          { role: "person", text: "Show me two looks", at: 1 },
          {
            role: "assistant",
            text: "Two designers are on it.",
            at: 2,
            parts: [
              {
                kind: "tool-trace",
                toolCallId: "call-mockups",
                name: "execute",
                status: "output-available",
                input: {
                  plugin: "designer",
                  action: "mockup",
                  input: {
                    concepts: [{ label: "Calm" }, { label: "Bold" }],
                  },
                },
              },
              { kind: "text", text: "Two designers are on it." },
            ],
          },
        ]}
      />,
    );
    const ticks = [
      ...html.matchAll(
        /data-slot="conversation-map-tick" data-turn-id="([^"]*)"/g,
      ),
    ].map((match) => match[1]);
    expect(ticks).toEqual([
      "person:1:0",
      "work:call-mockups:Calm",
      "work:call-mockups:Bold",
    ]);
    for (const id of ticks) expect(html).toContain(`data-item-id="${id}"`);
  });

  test("each question names what it asked and what came of it", () => {
    const html = renderToStaticMarkup(
      <RoomThread
        standing={(unit) => workUnitStanding(unit, room)}
        turns={[{ role: "person", text: "Make a todo app", at: 1 }]}
        questions={[
          {
            at: 10,
            signalName: "approve-requirements",
            asked: {
              plugin: "writer",
              action: "approve",
              input: { kinds: ["product_requirements"] },
            },
            answer: {
              output: {
                approved: [
                  {
                    kind: "product_requirements",
                    artifactId: "requirements",
                    version: 1,
                  },
                ],
              },
            },
          },
          {
            at: 20,
            signalName: "approve-plan",
            asked: {
              plugin: "writer",
              action: "approve",
              input: { kinds: ["build_plan"] },
            },
            answer: {
              output: {
                approved: [
                  { kind: "build_plan", artifactId: "plan", version: 1 },
                ],
              },
            },
          },
          {
            at: 30,
            signalName: "fonts",
            asked: { plugin: "designer", action: "pick-fonts", input: {} },
            answer: {
              output: {
                primary: { name: "Arial", lists: ["sans"], license: "free" },
                secondary: {
                  name: "Bitter",
                  lists: ["serif"],
                  license: "free",
                },
              },
            },
          },
          {
            at: 40,
            signalName: "looks",
            asked: {
              questions: [
                {
                  id: "q1",
                  question: "How many looks would you like to compare?",
                  header: "How many looks?",
                  options: [],
                  multiple: false,
                  custom: true,
                },
              ],
            },
            answer: { answers: { q1: ["Two"] } },
          },
        ]}
      />,
    );
    const ticks = [
      ...html.matchAll(
        /data-slot="conversation-map-tick"[^>]*aria-label="([^"]*)"/g,
      ),
    ].map((match) => match[1]);
    expect(ticks).toEqual([
      "Go to: Make a todo app",
      "Go to: Approve the requirements · Approved",
      "Go to: Approve the build plan · Approved",
      "Go to: Pick the fonts · Arial and Bitter",
      "Go to: How many looks? · Answered",
    ]);
  });

  test("an open approval's marker is named for the jump, not for the card's question", () => {
    const html = renderToStaticMarkup(
      <RoomThread
        standing={(unit) => workUnitStanding(unit, room)}
        turns={[{ role: "person", text: "Make a todo app", at: 1 }]}
        questions={[
          {
            at: 10,
            signalName: "approve-requirements",
            asked: {
              plugin: "writer",
              action: "approve",
              input: { kinds: ["product_requirements"] },
            },
          },
        ]}
        approvals={[
          {
            approvalId: "appr-1",
            toolName: "run_shell",
            subject: "bun run build",
            at: 30,
          },
        ]}
      />,
    );
    // Each control's accessible name: its aria-label, else its text.
    const names = [
      ...html.matchAll(
        /<button[^>]*?(?:aria-label="([^"]*)"[^>]*)?>(?:<(?!\/?button)[^>]*>)*([^<]*)/g,
      ),
    ].map((match) => match[1] ?? match[2]);
    expect(names).toContain("Go to: Approve the requirements");
    expect(names).toContain(
      "Go to: Let the specialist use run shell on bun run build?",
    );
    expect(
      names.filter((name) => name?.includes("Approve the requirements")),
    ).toEqual(["Go to: Approve the requirements"]);
    expect(new Set(names).size).toBe(names.length);
  });
});
