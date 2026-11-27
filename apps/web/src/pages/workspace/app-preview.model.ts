/**
 * Whether the project has an app to preview, and its user manual. There is one once an app is
 * filed or a coder is building it and the project says how its program starts.
 */
import { skipToken, useQuery } from "@tanstack/react-query";
import type { ProjectArtifact } from "@corbits-builder/client";
import { readProjectValues } from "../../api/artifacts.ts";
import { keys } from "../../queries/keys.ts";
import type { RoomSnapshot } from "./load-room.ts";
import { writesCode } from "./roles.ts";
import { useUserManual } from "./user-manual.model.ts";

// A coder at work can report how the project's program starts at any time.
const RUN_POLL_MS = 5_000;
const RUN_VALUE = "stack.run";

export function useAppPreview({
  projectId,
  snapshot,
  paneDeliverables,
  rolesAtWork,
}: {
  projectId: string;
  snapshot: RoomSnapshot;
  /** The documents the project view gives a tab, among them any build plan. */
  paneDeliverables: readonly ProjectArtifact[];
  /** The roles with a run mid-turn; undefined until read. */
  rolesAtWork: ReadonlySet<string> | undefined;
}) {
  const inFlight = snapshot.inFlight;
  const appFiled = snapshot.artifacts.some((item) => item.kind === "app");
  const firstBuilder = appFiled ? undefined : inFlight.find(writesCode);
  // There is an app to preview once one is filed, built here or imported, or a coder is building
  // it; a filed build plan shows where it will appear.
  const appComing =
    appFiled ||
    firstBuilder !== undefined ||
    paneDeliverables.some((item) => item.kind === "build_plan");
  // Only a project that says how its program starts, its stack.run, serves something to preview,
  // whatever its stack; a command-line tool has none.
  const run = useQuery({
    queryKey: keys.projectValues.run(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: inFlight.some(writesCode) ? RUN_POLL_MS : false,
    queryFn: appComing
      ? ({ signal }) => readProjectValues(projectId, [RUN_VALUE], signal)
      : skipToken,
  });
  const servesApp = (run.data?.[RUN_VALUE] ?? null) !== null;
  const liveApp =
    appComing && servesApp ? { projectId, builder: firstBuilder } : null;
  // The manual follows the app, so it is read again while the coder works.
  const userManual = useUserManual(
    projectId,
    liveApp !== null,
    rolesAtWork !== undefined &&
      [...rolesAtWork].some((role) => writesCode({ role })),
  );

  return { liveApp, userManual };
}
