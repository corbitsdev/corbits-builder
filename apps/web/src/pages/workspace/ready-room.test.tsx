import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { useRolesAtWork } from "./agent-activity.tsx";
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
      />
    </QueryClientProvider>,
  );
}

const emptyRoom: RoomSnapshot = {
  conversation: { events: null, turns: [], threads: [], runId: null },
  artifacts: [],
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
