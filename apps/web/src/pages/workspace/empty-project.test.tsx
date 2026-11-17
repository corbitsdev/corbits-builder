import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductApiError } from "@corbits-builder/client";
import { wording } from "../../config.ts";
import {
  ArtifactPane,
  type ArtifactPaneSlots,
  type PaneDocument,
} from "./artifact-pane.tsx";
import { documentReadFailure, documentsForPane } from "./document-read.ts";
import type { DeliverableState } from "./deliverable-block.tsx";

const sha = "ab".repeat(32);

function filed(id: string, title: string): PaneDocument {
  return {
    id,
    title,
    status: wording.documentStatus.drafted(1),
    unread: true,
    removable: false,
  };
}

// A written document draws none of the parts that read the hub.
const parts: ArtifactPaneSlots = {
  conceptMockup: () => null,
  approvalRounds: () => null,
  tweakPanel: () => null,
};

const brief = filed("problem_brief", "Weather App Problem Brief");
const design = filed("build_plan", "Weather design");

function ready(title: string, content: string): DeliverableState {
  return {
    status: "ready",
    document: {
      title,
      mediaType: "text/markdown",
      content,
      filedAt: "2026-10-30T12:00:00.000Z",
      version: 1,
      sha256: sha,
      before: null,
      versions: [],
    },
  };
}

describe("empty project room", () => {
  test("a rejected document is not a tab, and a real document still renders", () => {
    const rejected = documentReadFailure(
      new ProductApiError(
        new Response("", { status: 400, statusText: "Bad Request" }),
      ),
    );
    expect(rejected).toEqual({
      message: "This document is not available.",
      retryable: false,
    });
    const unavailable = documentReadFailure(
      new ProductApiError(
        new Response("", { status: 503, statusText: "Service Unavailable" }),
      ),
    );
    expect(unavailable.retryable).toBe(true);

    const states = new Map<string, DeliverableState>([
      [
        brief.id,
        {
          status: "error",
          message: rejected.message,
          retryable: rejected.retryable,
        },
      ],
      [design.id, ready("Weather design", "# Weather design\n\nThe page.")],
    ]);
    const visible = documentsForPane([brief, design], (item) =>
      states.get(item.id),
    );
    expect(visible.map((item) => item.id)).toEqual(["build_plan"]);

    const html = renderToStaticMarkup(
      <ArtifactPane
        projectTitle="Project"
        concepts={[]}
        documents={visible}
        selectedId="build_plan"
        state={states.get("build_plan")}
        onSelect={() => {}}
        onSeen={() => {}}
        open
        onClose={() => {}}
        {...parts}
      />,
    );
    expect(html).toContain('role="tab"');
    expect(html).toContain("Weather design");
    expect(html).toContain("The page.");
    expect(html).not.toContain("Weather App Problem Brief");
    expect(html).not.toContain("Bad Request");
    expect(html).not.toContain(`>${wording.action.retry}<`);
  });

  test("a transient read of an existing document keeps Try again", () => {
    const state: DeliverableState = {
      status: "error",
      message: "The project could not be reached. Try again.",
      retryable: true,
    };
    const visible = documentsForPane([design], () => state);
    const html = renderToStaticMarkup(
      <ArtifactPane
        projectTitle="Project"
        concepts={[]}
        documents={visible}
        selectedId={design.id}
        state={state}
        onSelect={() => {}}
        onSeen={() => {}}
        open
        onClose={() => {}}
        onRetry={() => {}}
        {...parts}
      />,
    );
    expect(html).toContain("Weather design");
    expect(html).toContain("The project could not be reached. Try again.");
    expect(html).toContain(`>${wording.action.retry}<`);
    expect(html).not.toContain("Service Unavailable");
    expect(html).not.toContain("Bad Request");
  });
});
