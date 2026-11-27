/** Restoring an archived project from its room, and why a restore did not go through. */
import { useState } from "react";
import { wording } from "../../config.ts";
import { restoreProject } from "../../api/projects.ts";
import { humanFaultWithCode } from "../../human-fault.ts";

export function useProjectRestore({
  projectId,
  refetchProject,
  onChanged,
}: {
  projectId: string;
  /** Reads the project again, so the room sees it active. */
  refetchProject: () => Promise<unknown>;
  onChanged: () => void;
}) {
  const [restoring, setRestoring] = useState(false);
  const [restoreFault, setRestoreFault] = useState<string | null>(null);
  const restore = async () => {
    setRestoring(true);
    setRestoreFault(null);
    try {
      await restoreProject(projectId);
      await refetchProject();
      onChanged();
    } catch (cause) {
      setRestoreFault(
        await humanFaultWithCode(cause, wording.archivedProject.restoreFailed),
      );
    } finally {
      setRestoring(false);
    }
  };
  return {
    restoring,
    fault: restoreFault,
    onRestore: () => void restore(),
  };
}
