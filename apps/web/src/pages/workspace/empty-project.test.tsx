import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductApiError } from "@corbits-builder/client";
import type { ProjectArtifact } from "@corbits-builder/client";
import { ArtifactPane } from "./artifact-pane.tsx";
import { documentReadFailure, documentsForPane } from "./document-read.ts";
import type { DeliverableState } from "./deliverable-block.tsx";

const sha = "ab".repeat(32);

function filed(kind: string, title: string): ProjectArtifact {
  return { artifactId: kind, kind, title, version: 1, sha256: sha };
}

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
        brief.kind,
        {
          status: "error",
          message: rejected.message,
          retryable: rejected.retryable,
        },
      ],
      [design.kind, ready("Weather design", "# Weather design\n\nThe page.")],
    ]);
    const visible = documentsForPane([brief, design], (item) =>
      states.get(item.kind),
    );
    expect(visible.map((item) => item.kind)).toEqual(["build_plan"]);

    const html = renderToStaticMarkup(
      <ArtifactPane
        projectTitle="Project"
        deliverables={visible}
        selected={visible[0] ?? null}
        state={states.get("build_plan")}
        changesOpen={false}
        onSelect={() => {}}
        onToggleChanges={() => {}}
      />,
    );
    expect(html).toContain('role="tab"');
    expect(html).toContain("Weather design");
    expect(html).toContain("The page.");
    expect(html).not.toContain("Weather App Problem Brief");
    expect(html).not.toContain("Bad Request");
    expect(html).not.toContain("Retry");
  });

  test("a transient read of an existing document keeps Retry", () => {
    const state: DeliverableState = {
      status: "error",
      message: "The project could not be reached. Try again.",
      retryable: true,
    };
    const visible = documentsForPane([design], () => state);
    const html = renderToStaticMarkup(
      <ArtifactPane
        projectTitle="Project"
        deliverables={visible}
        selected={design}
        state={state}
        changesOpen={false}
        onSelect={() => {}}
        onToggleChanges={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("Weather design");
    expect(html).toContain("The project could not be reached. Try again.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Service Unavailable");
    expect(html).not.toContain("Bad Request");
  });
});
