import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SPECIALIST_ENDED_LEAD, wording } from "../../config.ts";
import { DocumentDecision } from "./document-decision.tsx";
import {
  CredentialRecoveryBanner,
  resolveCredentialRecovery,
} from "./credential-recovery.tsx";
import {
  awaitingCommit,
  emptyLiveRun,
  foldLiveRun,
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

  test("scrubs raw credential failure text from turns and specialist ends and terminates live thinking", () => {
    const rawError =
      "This agent could not complete your request due to a credential error [HTTP 401]: invalid x-api-key";
    const html = renderToStaticMarkup(
      <RoomThread
        turns={[
          { role: "person", text: "Design the landing page", at: 1 },
          {
            role: "person",
            text: `${SPECIALIST_ENDED_LEAD}Designer stopped before finishing.\n\nRecorded reason (step_failed): ${rawError}`,
            at: 2,
          },
          { role: "assistant", text: rawError, at: 3 },
        ]}
      />,
    );
    expect(html).toContain(wording.credentials.stopped);
    expect(html).toContain(wording.credentials.cause);
    expect(html).not.toContain("HTTP 401");
    expect(html).not.toContain("invalid x-api-key");

    const started = foldLiveRun(
      emptyLiveRun,
      { type: "message.run.started" },
      10,
    ).run;
    expect(started.running).toBe(true);
    const failed = foldLiveRun(
      started,
      {
        type: "inference.error",
        data: {
          error: {
            category: "credential_failure",
            statusCode: 401,
            message: "invalid x-api-key",
          },
        },
      },
      20,
    ).run;
    expect(failed.running).toBe(false);
    expect(failed.ended).toBe(true);
    expect(failed.credentialFailed).toBe(true);
  });

  test("resolves credential recovery with re-authenticate and handoff actions and clears once a later turn succeeds", () => {
    const binding = (provider: string) => ({
      provider,
      model: "m",
      effort: "medium" as const,
    });
    const catalog = {
      providers: [
        {
          id: "anthropic",
          plugin: "anthropic",
          label: "Anthropic",
          hint: "Claude",
          baseURL: "https://api.anthropic.com",
          kind: "api_key" as const,
          models: [],
          connections: [
            {
              id: "prv_anthropic",
              name: "Anthropic",
              credentialSet: true,
              status: "refused" as const,
              note: "HTTP 401",
            },
          ],
        },
        {
          id: "openai",
          plugin: "openai",
          label: "OpenAI",
          hint: "GPT",
          baseURL: "https://api.openai.com/v1",
          kind: "api_key" as const,
          models: [],
          connections: [
            {
              id: "prv_openai",
              name: "OpenAI",
              credentialSet: true,
              status: "connected" as const,
            },
          ],
        },
      ],
      roles: [],
      tiers: [],
      efforts: [],
      customApis: [],
      profiles: [
        {
          id: "anthropic_default",
          label: "Claude",
          hint: "HTTP 401",
          tiers: {
            low: binding("anthropic"),
            medium: binding("anthropic"),
            high: binding("anthropic"),
            max: binding("anthropic"),
          },
          available: false,
        },
        {
          id: "openai_default",
          label: "GPT",
          hint: "OpenAI",
          tiers: {
            low: binding("openai"),
            medium: binding("openai"),
            high: binding("openai"),
            max: binding("openai"),
          },
          available: true,
        },
      ],
    };

    const recovery = resolveCredentialRecovery({
      turns: [
        { role: "person", text: "Build the dashboard", at: 100 },
        {
          role: "assistant",
          text: "This agent could not complete your request due to a credential error [HTTP 401]: invalid x-api-key",
          at: 200,
        },
      ],
      failed: [],
      events: null,
      liveCredentialFailed: false,
      liveEndedAt: null,
      dismissedAt: 0,
      catalog,
      choice: { profile: "anthropic_default" },
    });
    expect(recovery).not.toBeNull();
    expect(recovery?.retryMessage).toBe("Build the dashboard");
    expect(recovery?.provider?.id).toBe("anthropic");
    expect(recovery?.alternatives).toEqual([
      { id: "openai_default", label: "GPT" },
    ]);

    // Once a later assistant turn succeeds, recovery clears.
    const cleared = resolveCredentialRecovery({
      turns: [
        { role: "person", text: "Build the dashboard", at: 100 },
        {
          role: "assistant",
          text: "This agent could not complete your request due to a credential error [HTTP 401]: invalid x-api-key",
          at: 200,
        },
        { role: "assistant", text: "Here is the dashboard.", at: 300 },
      ],
      failed: [],
      events: null,
      liveCredentialFailed: false,
      liveEndedAt: null,
      dismissedAt: 0,
      catalog,
      choice: { profile: "anthropic_default" },
    });
    expect(cleared).toBeNull();
    expect(CredentialRecoveryBanner).toBeDefined();
  });
});
