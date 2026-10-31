/**
 * Where the project stands and the person's one next step, as the hub derives them from native
 * state. The line is pinned above the conversation when the person's preference turns it on.
 */
import { useQuery } from "@tanstack/react-query";
import { Button, StatusDot } from "@corbits/react-ui";
import type {
  ProjectNextAction,
  ProjectStatus,
} from "@corbits-builder/schemas/project-status";
import { readProjectNextStep } from "../../api/activity.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import { keys } from "../../queries/keys.ts";
import { wording } from "../../config.ts";

const POLL_MS = 5_000;
// Mirrors the preference's id in apps/hub/src/config/preferences.ts.
const NEXT_STEP_LINE = "next_step_line";
const text = wording.nextStep;

export function useProjectNextStep(projectId: string, enabled = true) {
  return useQuery({
    queryKey: keys.projectNextStep.of(projectId),
    enabled,
    queryFn: ({ signal }) => readProjectNextStep(projectId, signal),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
  });
}

function useNextStepLineOn() {
  const preferences = useQuery({
    queryKey: keys.preferences,
    queryFn: async () => {
      const tenantId = await workspaceTenantId();
      const [registry, record] = await Promise.all([
        productClient().preferenceRegistry(tenantId),
        productClient().personalSettings(tenantId),
      ]);
      const chosen = record.fields.preferences?.value;
      return Object.fromEntries(
        registry.preferences.map((entry) => [
          entry.id,
          chosen?.[entry.id] ?? entry.default,
        ]),
      );
    },
    staleTime: Infinity,
  });
  return preferences.data?.[NEXT_STEP_LINE] === "yes";
}

/** One line: who works now and the next step, with the step's own control when it has one. */
export function NextStepLine({
  projectId,
  actions,
}: {
  projectId: string;
  /** The workspace's real controls; a step whose control is absent here shows no button. */
  actions: Partial<Record<ProjectNextAction, () => void>>;
}) {
  const on = useNextStepLineOn();
  const status = useProjectNextStep(projectId, on);
  if (!on || status.data === undefined) return null;
  return <Line status={status.data} actions={actions} />;
}

function Line({
  status,
  actions,
}: {
  status: ProjectStatus;
  actions: Partial<Record<ProjectNextAction, () => void>>;
}) {
  const action = status.next.action;
  const run = action === undefined ? undefined : actions[action];
  const busy = status.working.some((item) => item.state === "working");
  return (
    <div className="next-step-line" role="status">
      <StatusDot
        label=""
        size="xs"
        live={busy}
        tone={busy ? "emphasis" : "neutral"}
      />
      <p className="next-step-text" title={`${status.now} ${status.next.text}`}>
        <span className="next-step-now">{status.now}</span>{" "}
        <strong>{status.next.text}</strong>
      </p>
      {action === undefined || run === undefined ? null : (
        <Button type="button" size="sm" variant="outline" onClick={run}>
          {text.action[action]}
        </Button>
      )}
    </div>
  );
}
