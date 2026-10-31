import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { wording } from "../../config.ts";
import { DocumentDecision } from "./document-decision.tsx";
import { waitingOnPerson } from "./live-run.ts";
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
    expect(html).not.toContain("request_approval");
    expect(html).not.toContain("appr-1");
    expect(html).not.toContain(briefId);
    expect(html).not.toContain("approve_artifact");
    expect(html).not.toContain("sha256");
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
});
