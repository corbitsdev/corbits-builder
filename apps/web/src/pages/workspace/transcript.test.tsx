import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clippedTurnText,
  maxTurnText,
} from "@corbits-builder/schemas/conversation";
import { wording } from "../../config.ts";
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

describe("conversation transcript", () => {
  test("turns render through MessageParts and keep the conversation log name", () => {
    const html = renderToStaticMarkup(
      <RoomThread
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
    expect(html).not.toContain("Look up the city");
    expect(html).not.toContain("location");
    expect(html).not.toContain('data-slot="tool"');
    expect(html).not.toContain("Approved once");
    expect(html).not.toContain("Approve always");
  });

  test("a document name is a control that can open it, without its id", () => {
    const html = renderToStaticMarkup(
      <RoomThread
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
    expect(html).toContain('class="artifact-mention"');
    expect(html).toContain("problem brief");
    expect(html).toContain("What should the outcome be?");
    expect(html).not.toContain(briefId);
    expect(html).not.toContain("sha256");
  });

  test("an approval asks about the document in words", () => {
    const html = renderToStaticMarkup(
      <RoomThread
        turns={[]}
        approvals={[
          {
            approvalId: "appr-1",
            toolName: "request_approval",
            document: { kind: briefId, title: "Problem brief", version: 4 },
          },
        ]}
        onDecide={() => {}}
      />,
    );
    expect(html).toContain("Happy with the brief?");
    expect(html).toContain(">Yes, go ahead<");
    expect(html).toContain(">Not yet<");
    expect(html).not.toContain(">Not Yet<");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Start Designs");
    expect(html).not.toContain("request_approval");
    expect(html).not.toContain("appr-1");
    expect(html).not.toContain(briefId);
    expect(html).not.toContain("approve_artifact");
    expect(html).not.toContain("sha256");
  });

  test("a design start does not offer to go ahead without asking", () => {
    const html = renderToStaticMarkup(
      <DocumentDecision
        approval={{ approvalId: "appr-1", toolName: "design_app" }}
        onYes={() => {}}
        onAlways={() => {}}
        onNo={() => {}}
      />,
    );
    expect(html).toContain("document-decision-once");
    expect(html).toContain(">Start Designs<");
    expect(html).not.toContain("Start designs without asking");
  });

  test("Not yet denies the approval and then takes the person to the composer", () => {
    const calls: string[] = [];
    const thread = RoomThread({
      turns: [],
      approvals: [
        {
          approvalId: "appr-1",
          toolName: "design_app",
          document: { kind: briefId, title: "Problem brief", version: 1 },
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
          name: "request_approval",
          arguments: { kinds: ["approaches"] },
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
          name: "request_approval",
          arguments: { kinds: ["brief"] },
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

  test("a specialist's report joins its hand-off as one message and a long run of lone ones folds", () => {
    const summary =
      "Wrote the limits for your weather app, covering offline use and units.";
    const html = renderToStaticMarkup(
      <RoomThread
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
                name: "deploy_writer",
                status: "output-available",
                input: {
                  kind: "constraints",
                  instruction: "Write the limits.",
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
    expect(html).toContain('data-item-id="work:call-1"');
    expect(html).toContain(`>${wording.activity.role.writer}<`);
    expect(html).not.toContain('class="room-mail-names">Constraints<');
    expect(html).toContain(wording.updatesFolded(4));
    expect(html).toContain(`class="room-mail-names">${wording.buildSubject}<`);
  });

  test("a coordinator stretch has one header, its words first and its cards last", () => {
    const html = renderToStaticMarkup(
      <RoomThread
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
            document: { kind: briefId, title: "Problem brief", version: 1 },
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
      "Happy with the brief?",
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
      <RoomThread turns={[{ role: "assistant", text: dump, at: 2 }]} />,
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

  test("a design approval lists each look and starts one by name", () => {
    const html = renderToStaticMarkup(
      <DocumentDecision
        approval={{
          approvalId: "appr-design",
          toolName: "design_app",
          concepts: [
            {
              label: "Clear Skies",
              direction:
                "Crisp cool neutrals, one cobalt accent, generous whitespace.",
            },
          ],
        }}
        onYes={() => {}}
        onAlways={() => {}}
        onNo={() => {}}
      />,
    );
    expect(html).toContain(">Clear Skies<");
    expect(html).toContain(">Crisp cool neutrals<");
    expect(html).not.toContain("generous whitespace");
    expect(html).toContain(">Start Clear Skies<");
    expect(html).toContain(">Not Yet<");

    const several = renderToStaticMarkup(
      <DocumentDecision
        approval={{
          approvalId: "appr-several",
          toolName: "design_app",
          concepts: [
            { label: "Clear Skies", direction: "Crisp cool neutrals." },
            {
              label: "Night Dock",
              direction: "Square corners (--radius 0), a deep navy primary.",
            },
          ],
        }}
        onYes={() => {}}
        onAlways={() => {}}
        onNo={() => {}}
      />,
    );
    expect(several).toContain(">Start Designs<");
    expect(several).toContain(">Night Dock<");
    expect(several).not.toContain("--radius");
    expect(several).not.toContain(">Start Clear Skies<");
  });
});
