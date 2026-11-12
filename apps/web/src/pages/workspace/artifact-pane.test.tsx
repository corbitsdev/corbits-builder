import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { wording } from "../../config.ts";
import {
  ArtifactPane,
  availableTab,
  defaultTab,
  resolveSelection,
  type ArtifactPaneSlots,
  type PaneDocument,
} from "./artifact-pane.tsx";
import { APPROVAL_PACKAGE_MEDIA_TYPE } from "./approval-package.ts";
import { ApprovalRoundsPanel } from "./approval-rounds.tsx";
import {
  DeliverableBody,
  type DeliverableState,
} from "./deliverable-block.tsx";
import { TweakPanel } from "./mockup-tweaks.tsx";
import { LIVE_TAB } from "./tab-follow.ts";

const filed = (id: string, title: string, version: number): PaneDocument => ({
  id,
  title,
  status: wording.documentStatus.drafted(version),
  unread: true,
  removable: false,
});
const ready = filed("problem_brief", "Problem brief", 2);
const document: DeliverableState = {
  status: "ready",
  document: {
    title: "Problem brief",
    mediaType: "text/markdown",
    content: "# Real output\nUpdated content",
    filedAt: "2026-10-30T12:00:00.000Z",
    version: 2,
    sha256: "a".repeat(64),
    before: {
      version: 1,
      content: "Previous content",
      filedAt: "2026-10-30T11:00:00.000Z",
    },
    versions: [],
  },
};
const parts: ArtifactPaneSlots = {
  conceptMockup: () => null,
  approvalRounds: (rounds) => (
    <ApprovalRoundsPanel projectId="project" flush {...rounds} />
  ),
  tweakPanel: (panel) => (
    <TweakPanel {...panel} design={{ projectId: "project" }} />
  ),
};
function render(selected: PaneDocument | null, state?: DeliverableState) {
  return renderToStaticMarkup(
    <ArtifactPane
      projectTitle="Project"
      concepts={[]}
      documents={selected === null ? [] : [selected]}
      selectedId={selected === null ? null : selected.id}
      state={state}
      onSelect={() => {}}
      onSeen={() => {}}
      onClose={() => {}}
      {...parts}
    />,
  );
}

describe("persistent artifact pane", () => {
  test("exists before artifacts without modal or Expand controls", () => {
    const html = render(null);
    expect(html).toContain('aria-label="Artifacts"');
    expect(html).toContain("Your outputs appear here");
    expect(html).not.toContain(">Artifacts<");
    expect(html).not.toContain(">Output<");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("inert");
    expect(html).not.toContain("Expand");
  });
  test("renders real content immediately with selection and available changes", () => {
    const html = render(ready, document);
    expect(html).toContain("Real output");
    expect(html).toContain("Updated content");
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("<select");
    // The pane opens a comparison itself, so the open one is drawn through the document's body.
    const comparing = renderToStaticMarkup(
      <DeliverableBody
        state={document}
        fileName={{ project: "Project", document: "Problem brief" }}
        changesOpen
        onToggleChanges={() => {}}
        {...parts}
      />,
    );
    expect(comparing).toContain("Real output");
    expect(comparing).toContain("Updated content");
    expect(comparing).toContain("Comparing v1 → v2");
    expect(comparing).toContain("Previous content");
    expect(comparing).toContain("v1 → v2");
    expect(comparing).not.toContain("<select");
  });
  test("shows the document title once and hides a single retained version", () => {
    if (document.status !== "ready") throw new Error("invalid fixture");
    const title = "Weather App First-Version Problem Brief";
    const html = render(
      { ...ready, title },
      {
        status: "ready",
        document: {
          ...document.document,
          title,
          version: 1,
          content: `# ${title}\n\nThe forecast for the weekend.`,
          versions: [
            {
              version: 1,
              title,
              mediaType: "text/markdown",
            },
          ],
        },
      },
    );
    expect(html).toContain('role="tab"');
    expect(html.split(`>${title}<`).length - 1).toBe(1);
    expect(html).toContain("The forecast for the weekend.");
    expect(html).not.toContain(">Artifacts<");
    expect(html).not.toContain(">Output<");
    expect(html).not.toContain("only retained version");
    expect(html).not.toContain("<select");
  });
  test("renders HTML as a sandboxed design preview", () => {
    if (document.status !== "ready") throw new Error("invalid fixture");
    const html = render(ready, {
      status: "ready",
      document: {
        ...document.document,
        mediaType: "text/html",
        content: "<h1>Actual design</h1>",
      },
    });
    expect(html).toContain('title="Design"');
    expect(html).toContain('sandbox=""');
    expect(html).toContain('srcDoc="&lt;h1&gt;Actual design&lt;/h1&gt;"');
    // A page among a document's parts keeps its own height; only a whole-pane page fills.
    expect(html).not.toMatch(
      /<[a-z]+[^>]*data-slot="device-preview"[^>]*data-fill/,
    );
    expect(html).not.toMatch(/<iframe[^>]*data-fill/);
  });
  test("a page that fills the pane shows its notes as pills over it", () => {
    if (document.status !== "ready") throw new Error("invalid fixture");
    const note = (mediaType: string, title: string) =>
      /<p[^>]*data-slot="inline-note"[^>]*>History unavailable/.exec(
        render(
          { ...ready, title },
          {
            status: "ready",
            document: {
              ...document.document,
              title,
              mediaType,
              content: "name,count\nbolts,4",
              historyError: "offline",
            },
          },
        ),
      )?.[0] ?? "";
    expect(note("text/plain", "parts.csv")).toContain('data-pill=""');
    expect(note("text/markdown", "Problem brief")).toContain(
      'data-slot="inline-note"',
    );
    expect(note("text/markdown", "Problem brief")).not.toContain("data-pill");
  });
  test("shows compact loading and read errors", () => {
    expect(render(ready, { status: "loading" })).toContain(
      "Reading the document…",
    );
    expect(
      render(ready, {
        status: "error",
        message: "Retained content unavailable",
        retryable: true,
      }),
    ).toContain("Retained content unavailable");
  });
  test("renders approval_package deliverable with Approval tab", () => {
    if (document.status !== "ready") throw new Error("invalid fixture");
    const pkgDeliverable = filed(
      "approval_package",
      "Executive Sign-off Package",
      1,
    );
    const bundleContent = JSON.stringify({
      manifest: {
        audience: "Board",
        decisionNeeded: "Approve launch",
        tone: "Concise",
        length: "3 slides",
        sources: [
          {
            artifactId: "11111111-1111-4111-8111-111111111111",
            kind: "problem_brief",
            title: "Problem brief",
            version: 2,
            sha256: "a".repeat(64),
          },
        ],
      },
      deck: {
        theme: {
          colors: {
            primary: "#1e293b",
            secondary: "#334155",
            accent: "#2563eb",
            background: "#ffffff",
            text: "#0f172a",
            muted: "#64748b",
          },
          fonts: { heading: "Inter", body: "Inter" },
        },
        slides: [
          {
            layout: "title",
            title: "Launch Readiness",
            subtitle: "Summary of approved scope",
          },
        ],
      },
      pptxBase64: Buffer.from("pptx").toString("base64"),
      pdfBase64: Buffer.from("pdf").toString("base64"),
    });
    const html = render(pkgDeliverable, {
      status: "ready",
      document: {
        ...document.document,
        title: "Executive Sign-off Package",
        mediaType: APPROVAL_PACKAGE_MEDIA_TYPE,
        version: 1,
        content: bundleContent,
      },
    });
    expect(html).toContain(">Approval<");
    expect(html).not.toContain(">Approval package<");
    expect(html).not.toContain(">Executive Sign-off Package</h1>");
    expect(html).toContain("Add new reviewer");
  });
});

describe("default tab", () => {
  const plan = filed("build_plan", "Build plan", 1);
  test("nothing chosen shows the live app once the build has started", () => {
    expect(defaultTab(true, [ready, plan])).toBe(LIVE_TAB);
  });
  test("before the build it shows the document furthest along, and nothing before any", () => {
    expect(defaultTab(false, [ready, plan])).toBe("build_plan");
    expect(defaultTab(false, [])).toBeNull();
  });
});

describe("remembered tab", () => {
  const plan = filed("build_plan", "Build plan", 1);
  const have = {
    liveApp: false,
    manual: false,
    themes: false,
    draft: false,
    concepts: [] as string[],
    documents: [ready, plan],
  };
  test("a remembered tab counts only while the pane can show it", () => {
    expect(availableTab("build_plan", have)).toBe("build_plan");
    expect(availableTab("design-mockup", have)).toBeNull();
    expect(availableTab(LIVE_TAB, have)).toBeNull();
    expect(availableTab(LIVE_TAB, { ...have, liveApp: true })).toBe(LIVE_TAB);
    expect(availableTab("user-manual", { ...have, manual: true })).toBe(
      "user-manual",
    );
    expect(availableTab(null, have)).toBeNull();
  });
  test("with nothing chosen yet, the remembered document opens instead of the default", () => {
    expect(resolveSelection(null, true, [ready, plan], ready.id)).toEqual({
      selectedId: null,
      documentToOpen: ready.id,
    });
    // A remembered side tab is the pane's own to restore; the default stands meanwhile.
    expect(resolveSelection(null, true, [ready, plan], LIVE_TAB)).toEqual({
      selectedId: LIVE_TAB,
      documentToOpen: null,
    });
    // One that is not filed here falls back to the default.
    expect(resolveSelection(null, false, [ready, plan], "design")).toEqual({
      selectedId: null,
      documentToOpen: "build_plan",
    });
    // The person's own choice always wins.
    expect(
      resolveSelection("build_plan", true, [ready, plan], ready.id),
    ).toEqual({ selectedId: "build_plan", documentToOpen: null });
  });
});
