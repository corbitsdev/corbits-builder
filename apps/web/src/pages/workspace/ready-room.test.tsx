import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { wording } from "../../config.ts";
import { cachePersister, savedReads } from "../../queries/client.ts";
import { keys } from "../../queries/keys.ts";
import { useRolesAtWork } from "./project-activity.ts";
import { StageWorkspace } from "./index.tsx";
import type { RoomSnapshot } from "./load-room.ts";

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
        onNewProject={() => {}}
        onProjectError={() => {}}
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
    questions: [],
  },
  artifacts: [],
  plan: { steps: [], updatedAt: null, screens: [], asked: [] },
  inFlight: [],
  failed: [],
  documents: {},
};

describe("project room", () => {
  test("an unread room is loading, with the room's other reads already under way", () => {
    const queryClient = client();
    expect(room(queryClient)).toContain(
      wording.message.projectLoading("Weather"),
    );
    for (const key of [
      keys.projectActivity.of(projectId),
      keys.projectRunStates.of(projectId),
      keys.acceptedMaterials.of(projectId),
    ])
      expect(queryClient.getQueryState(key)?.fetchStatus).toBe("fetching");

    const loaded = client();
    loaded.setQueryData(keys.projectRoom.of(projectId), emptyRoom);
    const read = room(loaded);
    expect(read).not.toContain(wording.message.projectLoading("Weather"));
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
            onNewProject={() => {}}
            onProjectError={() => {}}
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
    expect(same).not.toContain(wording.message.projectLoading(projectId));
    expect(same).toContain("Hello from the weather app");
    const other = opened(reloaded, "project-2");
    expect(other).toContain(wording.message.projectLoading("project-2"));
    expect(other).not.toContain("Hello from the weather app");
  });

  test("what the hub worked out for a screen is never saved in the browser", async () => {
    const visited = client();
    visited.setQueryData(keys.project.of(projectId), {
      status: "active",
      tenantId: "tenant-1",
    });
    visited.setQueryData(keys.projectRoom.of(projectId), {
      ...emptyRoom,
      plan: {
        ...emptyRoom.plan,
        screens: [
          {
            plugin: "keeper",
            action: "kept",
            render: "plugin-bar",
            state: { link: "https://keep.example/secret-link" },
          },
        ],
        asked: [
          {
            signalName: "signal-1",
            data: { link: "https://keep.example/secret-link" },
          },
        ],
      },
    });
    renderToStaticMarkup(
      <QueryClientProvider client={visited}>
        <StageWorkspace
          projectId={projectId}
          projectTitle="Weather"
          onChanged={() => {}}
          onOpenSettings={() => {}}
          onNewProject={() => {}}
          onProjectError={() => {}}
        />
      </QueryClientProvider>,
    );
    const stored = new Map<string, string>();
    await cachePersister({
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value: string) => void stored.set(key, value),
      removeItem: (key) => void stored.delete(key),
    }).persistClient({
      timestamp: Date.now(),
      buster: "",
      clientState: dehydrate(visited, savedReads),
    });
    const [saved = ""] = stored.values();
    expect(saved).not.toContain("secret-link");
    const reloaded = client();
    hydrate(reloaded, JSON.parse(saved).clientState);
    expect(
      reloaded.getQueryData<RoomSnapshot>(keys.projectRoom.of(projectId))?.plan,
    ).toEqual(emptyRoom.plan);
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
          onNewProject={() => {}}
          onProjectError={() => {}}
        />
      </QueryClientProvider>,
    );
    const shared: readonly unknown[] = [
      keys.modelCatalog[0],
      keys.preferences[0],
      keys.workspaceTenant[0],
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
