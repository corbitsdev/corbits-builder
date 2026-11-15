import { getLogger } from "@intx/log";
import {
  WORKFLOW_RUN_REF,
  workflowRunRepoIdForAddress,
  type WorkflowRunReader,
} from "@intx/hub-sessions";
import {
  coordinatorQuestions,
  type ConversationQuestion,
} from "@corbits-builder/schemas/conversation";

import { requestErrorMetadata } from "../request-error.ts";

const log = getLogger(["corbits-builder", "hub", "earlier-questions"]);

/**
 * The questions of a project's earlier coordinator runs, in run order, none open. An earlier run that
 * cannot be read costs only its own questions, so the person is never blocked by it.
 */
export async function earlierRunQuestions(
  runReader: WorkflowRunReader,
  runs: readonly { runId: string; address: string }[],
): Promise<ConversationQuestion[]> {
  const perRun = await Promise.all(
    runs.map(async ({ runId, address }) => {
      try {
        return coordinatorQuestions(
          await runReader.readRunEvents(
            workflowRunRepoIdForAddress(address),
            WORKFLOW_RUN_REF,
            runId,
          ),
          false,
        );
      } catch (error) {
        const { errorType, errorLocations } = requestErrorMetadata(error);
        log.error("Earlier coordinator run unreadable", {
          runId,
          errorType,
          errorLocations,
        });
        return [];
      }
    }),
  );
  return perRun.flat();
}
