import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clippedTurnText,
  maxTurnText,
} from "@corbits-builder/schemas/conversation";
import { wording } from "../../config.ts";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import { DocumentDecision } from "./document-decision.tsx";
import {
  awaitingCommit,
  awaitingReply,
  emptyLiveRun,
  foldLiveRun,
  liveTurnStreaming,
  parkedOnApproval,
  pendingLiveTurn,
  waitingOnPerson,
} from "./live-run.ts";
import { RoomThread } from "./transcript.tsx";
import { workUnitStanding } from "./work-unit-step.model.ts";
import type { WorkUnit } from "./work-unit.ts";

function findElement(
  node: ReactNode,
  type: unknown,
): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child as ReactNode, type);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as { type: unknown; props: Record<string, unknown> };
  if (element.type === type) return element;
  return findElement(element.props["children"] as ReactNode, type);
}

const briefId = "problem_brief";

// A room with nothing filed and no run at work, so each hand-off stands where its own call puts it.
const standing = (unit: WorkUnit) =>
  workUnitStanding(unit, {
    artifacts: [],
    inFlight: [],
    failed: [],
    seen: new Map(),
  });

describe("conversation transcript", () => {
  test("turns render through MessageParts and keep the conversation log name", () => {
    const html = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        turns={[
          { role: "person", text: "What is the weather?", at: 1 },
          {
            role: "assistant",
            text: "Checking.",
            at: -1,
            parts: [
              { kind: "reasoning", text: "Look up the city" },
              {
                kind: "tool-trace",
                toolCallId: "call-1",
                name: "weather",
                status: "running",
                input: { location: "SF" },
              },
              { kind: "text", text: "Checking." },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-label="Conversation"');
    expect(html).toContain('data-slot="message-parts"');
    expect(html).toContain("What is the weather?");
    expect(html).toContain("Checking.");
    expect(html).not.toContain("location");
    expect(html).not.toContain("Approved once");
    expect(html).not.toContain("Approve always");
  });

  test("a document name is a control that can open it, without its id", () => {
    const html = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        turns={[
          {
            role: "assistant",
            text: "I drafted the problem brief. What should the outcome be?",
            at: 2,
          },
        ]}
        documents={[{ id: briefId, title: "Problem brief" }]}
        onOpenDocument={() => {}}
      />,
    );
    expect(html).toContain('data-slot="document-mention"');
    expect(html).toContain("problem brief");
    expect(html).toContain("What should the outcome be?");
    expect(html).not.toContain(briefId);
    expect(html).not.toContain("sha256");
  });

  test("a bold document name stays inline in its sentence and opens by click or key", () => {
    const source =
      "Already written into **Ways to build your list**. What the app does is next.";
    const documents = [{ id: "approaches", title: "Ways to build your list" }];
    const html = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        turns={[{ role: "assistant", text: source, at: 2 }]}
        documents={documents}
        onOpenDocument={() => {}}
      />,
    );
    // Inline, not a <button>: a button is one unbreakable box, so the title would leave the line.
    expect(html.replace(/ class="[^"]*"/g, "")).toContain(
      'into <strong><span role="button" tabindex="0" data-slot="document-mention">Ways to build your list</span></strong>. What',
    );
    expect(html).not.toContain("href");

    const opened: string[] = [];
    const mention = findElement(
      Markdown({
        source: "See [Ways to build your list](document:approaches).",
        openDocument: (id) => opened.push(id),
      }),
      "span",
    );
    (mention?.props["onClick"] as (() => void) | undefined)?.();
    const onKeyDown = mention?.props["onKeyDown"] as
      | ((event: { key: string; preventDefault(): void }) => void)
      | undefined;
    const prevented: string[] = [];
    for (const key of ["Enter", " ", "Tab"]) {
      onKeyDown?.({ key, preventDefault: () => prevented.push(key) });
    }
    expect(opened).toEqual(["approaches", "approaches", "approaches"]);
    expect(prevented).toEqual(["Enter", " "]);
  });

  test("Not yet denies the approval and then takes the person to the composer", () => {
    const calls: string[] = [];
    const thread = RoomThread({
      standing,
      turns: [],
      approvals: [
        {
          approvalId: "appr-1",
          toolName: "run_shell",
          subject: "bun run build",
        },
      ],
      onDecide: (decision) =>
        calls.push(`${decision.approvalId}:${decision.choice}`),
      onRequestChanges: () => calls.push("composer"),
    });
    const card = findElement(thread, DocumentDecision);
    (card?.props["onNo"] as (() => void) | undefined)?.();
    expect(calls).toEqual(["appr-1:no", "composer"]);
  });

  test("a coordinator held on an approval or a question is waiting, not thinking", () => {
    const approval = { runId: "run-c", approvalId: "appr-1" };
    const question = { runId: "run-c", park: { seq: 4 } };
    const coder = { runId: "run-coder", approvalId: "appr-2" };
    expect(
      waitingOnPerson([approval], new Set(["appr-1"]), "run-c", true),
    ).toBe(true);
    expect(waitingOnPerson([approval], new Set(), "run-c", true)).toBe(false);
    expect(waitingOnPerson([question], new Set(), "run-c", false)).toBe(true);
    expect(waitingOnPerson([question], new Set(), "run-c", true)).toBe(false);
    expect(waitingOnPerson([coder], new Set(["appr-2"]), "run-c", true)).toBe(
      false,
    );
  });

  test("a sent message waits on the coordinator until its approval card opens, and through an answered question", () => {
    const approval = { runId: "run-c", approvalId: "appr-1" };
    const question = { runId: "run-c", park: { seq: 4 } };
    const heldOnCard = parkedOnApproval(
      [approval],
      new Set(["appr-1"]),
      "run-c",
    );
    expect(awaitingReply(10, "person", null, false)).toBe(true);
    expect(awaitingReply(10, "person", null, heldOnCard)).toBe(false);
    expect(awaitingReply(10, "assistant", null, false)).toBe(false);
    expect(awaitingReply(10, "person", 12, false)).toBe(false);
    // The answer is sent while the question still stands and before the stream reports the run.
    const answered = parkedOnApproval([question], new Set(), "run-c");
    expect(awaitingReply(20, "person", 12, answered)).toBe(true);
  });

  test("an inference call that finishes with tool work settles even while the message run stays open on a park", () => {
    const started = foldLiveRun(
      emptyLiveRun,
      { type: "inference.start" },
      null,
    ).run;
    const withTool = foldLiveRun(
      started,
      {
        type: "inference.tool_call.end",
        data: {
          callId: "call-1",
          name: "execute",
          arguments: { plugin: "writer", action: "write" },
        },
      },
      null,
    ).run;
    expect(awaitingCommit(withTool, [])).toBe(false);
    const done = foldLiveRun(withTool, { type: "inference.done" }, null).run;
    expect(done.ended).toBe(false);
    expect(awaitingCommit(done, [])).toBe(true);
  });

  test("a reply over a turn's length is committed by its clipped copy, even when the clip drops half an emoji", () => {
    const reply = `${"a".repeat(maxTurnText - 1)}😀 and more`;
    const run = [
      { type: "inference.start" },
      { type: "inference.text.delta", data: { partial: { text: reply } } },
      { type: "inference.done" },
    ].reduce((live, event) => foldLiveRun(live, event, null).run, emptyLiveRun);
    expect(
      pendingLiveTurn(run, [
        { role: "assistant", text: clippedTurnText(reply), at: 5 },
      ]),
    ).toBeNull();
  });

  test("a turn held on the person's approval is no longer being written", () => {
    const held = [
      { type: "message.run.started" },
      { type: "inference.start" },
      {
        type: "inference.tool_call.end",
        data: {
          callId: "call-1",
          name: "question",
          arguments: { plugin: "designer", action: "pick-fonts" },
        },
      },
      { type: "inference.done" },
    ].reduce((run, event) => foldLiveRun(run, event, null).run, emptyLiveRun);
    const waits = [
      { runId: "run-c", approvalId: "appr-1" },
      { runId: "run-coder", approvalId: "appr-2" },
    ];
    const streaming = (open: string[]) =>
      liveTurnStreaming(
        held,
        [],
        parkedOnApproval(waits, new Set(open), "run-c"),
      );
    expect(held.ended).toBe(false);
    expect(streaming(["appr-1"])).toBe(false);
    expect(streaming(["appr-2"])).toBe(true);
    expect(streaming([])).toBe(true);
  });

  test("a coordinator turn shows one live line, at the bottom", () => {
    const live = {
      role: "assistant",
      text: "",
      at: -1,
      streaming: true,
      parts: [{ kind: "reasoning", text: "Read the idea" }],
    } as const;
    const thinkingLine = 'data-item-id="colleague-thinking"';
    const liveLines = (html: string) =>
      html.split('data-slot="activity" data-streaming="true"').length -
      1 +
      html.split(thinkingLine).length -
      1;
    const alone = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        turns={[{ role: "person", text: "Start", at: 1 }, live]}
        thinking
      />,
    );
    expect(liveLines(alone)).toBe(1);
    expect(alone).not.toContain(thinkingLine);
    const report = "Saved the requirements.";
    const afterReport = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        turns={[
          { role: "person", text: "Start", at: 1 },
          { role: "assistant", text: "Being written up now.", at: 2 },
          live,
        ]}
        updates={[{ sender: "writer", text: report, at: 3 }]}
        thinking
      />,
    );
    expect(liveLines(afterReport)).toBe(1);
    expect(afterReport.indexOf(thinkingLine)).toBeGreaterThan(
      afterReport.indexOf(report),
    );
  });

  test("a started specialist is a step of the coordinator's list and a long run of lone reports folds", () => {
    const summary =
      "Wrote the limits for your weather app, covering offline use and units.";
    const html = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        // The writer is still at work, so the coordinator's list stays open on it.
        live={() => true}
        turns={[
          { role: "person", text: "Start", at: 1 },
          {
            role: "assistant",
            text: "Starting the constraints.",
            at: 2,
            parts: [
              {
                kind: "tool-trace",
                toolCallId: "call-1",
                name: "execute",
                status: "output-available",
                input: {
                  plugin: "writer",
                  action: "write",
                  input: {
                    kind: "constraints",
                    instruction: "Write the limits.",
                  },
                },
              },
              { kind: "text", text: "Starting the constraints." },
            ],
          },
          { role: "participant", sender: "writer", text: summary, at: 3 },
          { role: "person", text: "Build it", at: 4 },
          {
            role: "participant",
            sender: "coder",
            text: "Scaffolded the app.",
            at: 5,
          },
          {
            role: "participant",
            sender: "designer",
            text: "Drafted the layout.",
            at: 6,
          },
          {
            role: "participant",
            sender: "coder",
            text: "Wired the forecast.",
            at: 7,
          },
          {
            role: "participant",
            sender: "designer",
            text: "Tuned the colours.",
            at: 8,
          },
        ]}
      />,
    );
    expect(html).not.toContain('data-item-id="work:');
    const row = wording.dispatch.row(
      wording.activity.role.writer,
      "Writing the constraints",
    );
    expect(html).toContain(row);
    expect(html.indexOf('data-slot="activity-content"')).toBeLessThan(
      html.indexOf(row),
    );
    expect(html).not.toContain('data-slot="update-names">Constraints<');
    expect(html).toContain(wording.updatesFolded(4));
    expect(html).toContain(`data-slot="update-names">${wording.buildSubject}<`);
  });

  test("a coordinator stretch has one header, its words first and its cards last", () => {
    const html = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        turns={[
          { role: "person", text: "Start", at: 1 },
          { role: "assistant", text: "First words.", at: 2 },
          { role: "assistant", text: "Second words.", at: 4 },
          { role: "person", text: "Next", at: 5 },
          { role: "assistant", text: "Later words.", at: 6 },
        ]}
        approvals={[
          {
            approvalId: "appr-1",
            toolName: "run_shell",
            at: 3,
          },
        ]}
        onDecide={() => {}}
      />,
    );
    expect(html.split(`>${wording.speaker.coordinator}<`)).toHaveLength(3);
    const order = [
      "Start",
      "First words.",
      "Second words.",
      wording.approval.tool("run shell"),
      "Next",
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right),
    );
  });

  test("a reported workflow dump keeps the outcome and hides the bookkeeping", () => {
    const hash = "a".repeat(64);
    const dump = [
      "The constraints document is ready for you to review.",
      "",
      "revision: 4",
      `sha256: ${hash}`,
      "specialist run run_01HSPECIALIST",
      "assignmentReady: true",
      "send_workflow_message",
      "artifactId: artifact-sb-ly2mtlm1x-constraints",
      "projectId: sb-ly2mtlm1x",
      "blocker: specialist_project_mismatch",
      '{"status":"deployed","revision":"4","eventCount":2,"assignmentReady":false,"runId":"run_01HSPECIALIST"}',
    ].join("\n");
    const html = renderToStaticMarkup(
      <RoomThread
        standing={standing}
        turns={[{ role: "assistant", text: dump, at: 2 }]}
      />,
    );
    expect(html).toContain(
      "The constraints document is ready for you to review.",
    );
    expect(html).toContain('aria-label="Conversation"');
    expect(html).toContain('role="log"');
    for (const hidden of [
      "revision",
      hash,
      "run_01HSPECIALIST",
      "assignmentReady",
      "send_workflow_message",
      "artifact-sb-ly2mtlm1x-constraints",
      "sb-ly2mtlm1x",
      "specialist_project_mismatch",
      "eventCount",
      "artifactId",
      "projectId",
    ]) {
      expect(html).not.toContain(hidden);
    }
  });
});
