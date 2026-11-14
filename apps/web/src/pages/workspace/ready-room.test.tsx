import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { wording } from "../../config.ts";
import { savedReads } from "../../queries/client.ts";
import { keys } from "../../queries/keys.ts";
import { useRolesAtWork } from "./project-activity.ts";
import { StageWorkspace } from "./index.tsx";
import type { RoomSnapshot } from "./load-room.ts";
import { paneDocument, tabbedArtifacts } from "./room.model.ts";

const projectId = "project-1";

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function room(queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <StageWorkspace
        projectId={projectId}
        projectTitle="Weather"
        listedArchived
        onChanged={() => {}}
        onOpenSettings={() => {}}
      />
    </QueryClientProvider>,
  );
}

const emptyRoom: RoomSnapshot = {
  conversation: {
    events: null,
    turns: [],
    threads: [],
    runId: null,
    earlierQuestions: [],
  },
  artifacts: [],
  plan: [],
  inFlight: [],
  failed: [],
  documents: {},
};

describe("project room", () => {
  test("an unread room is loading, with the room's other reads already under way", () => {
    const queryClient = client();
    expect(room(queryClient)).toContain(wording.message.projectLoading);
    for (const key of [
      keys.projectActivity.of(projectId),
      keys.projectRunStates.of(projectId),
      keys.projectNextStep.of(projectId),
      keys.acceptedMaterials.of(projectId),
    ])
      expect(queryClient.getQueryState(key)?.fetchStatus).toBe("fetching");

    const loaded = client();
    loaded.setQueryData(keys.projectRoom.of(projectId), emptyRoom);
    const read = room(loaded);
    expect(read).not.toContain(wording.message.projectLoading);
    expect(read).toContain(wording.archivedProject.conversationTitle);
  });

  test("a project's saved reads come back for that project only, without its open cards", () => {
    const opened = (queryClient: QueryClient, id: string) =>
      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <StageWorkspace
            projectId={id}
            projectTitle={id}
            onChanged={() => {}}
            onOpenSettings={() => {}}
          />
        </QueryClientProvider>,
      );
    const visited = client();
    visited.setQueryData(keys.project.of(projectId), {
      status: "active",
      tenantId: "tenant-1",
    });
    visited.setQueryData(keys.projectRoom.of(projectId), {
      ...emptyRoom,
      conversation: {
        ...emptyRoom.conversation,
        turns: [
          { role: "assistant", text: "Hello from the weather app", at: 1 },
        ],
      },
    });
    // The room builds its open-decisions read, so the card's own policy is the one saved.
    opened(visited, projectId);
    visited.setQueryData(keys.openDecisions.of(projectId), []);

    const reloaded = client();
    hydrate(reloaded, dehydrate(visited, savedReads));
    expect(
      reloaded.getQueryData(keys.openDecisions.of(projectId)),
    ).toBeUndefined();
    const same = opened(reloaded, projectId);
    expect(same).not.toContain(wording.message.projectLoading);
    expect(same).toContain("Hello from the weather app");
    const other = opened(reloaded, "project-2");
    expect(other).toContain(wording.message.projectLoading);
    expect(other).not.toContain("Hello from the weather app");
  });

  test("every read a room makes names its project, or its project's tenant", () => {
    const queryClient = client();
    queryClient.setQueryData(keys.project.of(projectId), {
      status: "active",
      tenantId: "tenant-1",
    });
    queryClient.setQueryData(keys.projectRoom.of(projectId), {
      ...emptyRoom,
      conversation: { ...emptyRoom.conversation, runId: "run-1" },
    });
    queryClient.setQueryData(keys.runSteps("tenant-1", "run-1"), {
      status: "running",
      steps: [],
    });
    renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <StageWorkspace
          projectId={projectId}
          projectTitle="Weather"
          onChanged={() => {}}
          onOpenSettings={() => {}}
        />
      </QueryClientProvider>,
    );
    const shared: readonly unknown[] = [
      keys.modelCatalog[0],
      keys.preferences[0],
    ];
    const unscoped = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
      .filter(
        (key) =>
          !shared.includes(key[0]) &&
          !key.includes(projectId) &&
          !key.includes("tenant-1"),
      );
    expect(unscoped).toEqual([]);
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(10);
  });

  test("an approval package is a document only while stakeholder approvals are on", () => {
    const filed = (kind: string) => ({
      artifactId: kind,
      kind,
      title: kind,
      version: 1,
      sha256: "a".repeat(64),
      filedAt: "2026-10-30T12:00:00.000Z",
    });
    const artifacts = [filed("problem_brief"), filed("approval_package")];
    const kinds = (approvals: "on" | "off") =>
      tabbedArtifacts(artifacts, approvals).map((item) => item.kind);
    expect(kinds("on")).toEqual(["problem_brief", "approval_package"]);
    expect(kinds("off")).toEqual(["problem_brief"]);
  });

  test("a failed activity read is not nobody at work", async () => {
    function Roles() {
      const roles = useRolesAtWork(projectId);
      return (
        <p>
          {roles === undefined ? "unread" : `at work: ${[...roles].join(",")}`}
        </p>
      );
    }
    const render = (queryClient: QueryClient) =>
      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <Roles />
        </QueryClientProvider>,
      );

    const failed = client();
    await failed.prefetchQuery({
      queryKey: keys.projectActivity.of(projectId),
      queryFn: () => Promise.reject(new Error("The hub is down.")),
    });
    expect(render(failed)).toContain("unread");

    const idle = client();
    idle.setQueryData(keys.projectActivity.of(projectId), { agents: [] });
    expect(render(idle)).toContain("at work: </p>");
  });
});

test("a document revised after the person approved it is shown at its newest version, with no approval of an older one named", () => {
  const revised = paneDocument(
    {
      artifactId: "44444444-4444-4444-8444-444444444444",
      kind: "product_requirements",
      title: "Product requirements",
      version: 2,
      sha256: "0".repeat(64),
      filedAt: new Date(20).toISOString(),
      approvedVersion: 1,
    },
    { "44444444-4444-4444-8444-444444444444": 1 },
  );
  expect(revised.status).toBe(wording.documentStatus.approved(2));
  expect(revised.status).not.toContain("v1");
  // The viewer read v1; v2 is new to them, so the tab opens on it unread.
  expect(revised.unread).toBe(true);
});
