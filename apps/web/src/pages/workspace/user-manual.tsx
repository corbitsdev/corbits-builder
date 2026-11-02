/**
 * The app's user manual as the coder keeps it: docs/USER-MANUAL.md with the pictures check-app
 * saved, read from the hub while a build is under way or once the app is filed. It is read again
 * now and then while the coder works, since the manual follows the app.
 */
import { useQuery } from "@tanstack/react-query";
import type { UserManual } from "@corbits-builder/schemas/artifact";
import { readUserManual } from "../../api/artifacts.ts";
import { keys } from "../../queries/keys.ts";
import { Markdown } from "../../markdown.tsx";

const REFRESH_MS = 60_000;

export function useUserManual(
  projectId: string,
  enabled: boolean,
  coderWorking: boolean,
): UserManual | null {
  const manual = useQuery({
    queryKey: keys.userManual.of(projectId),
    queryFn: ({ signal }) => readUserManual(projectId, signal),
    enabled,
    refetchInterval: coderWorking ? REFRESH_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return manual.data ?? null;
}

/** The manual's pages, its pictures shown where it places them; the pane around it scrolls. */
export function UserManualPane({ manual }: { manual: UserManual }) {
  return (
    <Markdown
      source={manual.markdown}
      images={new Map(Object.entries(manual.pictures))}
    />
  );
}
