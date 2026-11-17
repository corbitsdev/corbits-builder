import type { ModelSetting, OutputBudget, Role } from "@corbits-builder/plugin";

// The coordinator is the hub's own agent, not a plugin's specialist, so the hub says here what a
// role says of it: the one role no plugin declares.
export const COORDINATOR: Pick<
  Role,
  "name" | "label" | "model" | "limits" | "preferences"
> = {
  name: "coordinator",
  label: "Coordinator",
  model: "coordinator",
  limits: "coordinator",
  preferences: [
    "questions",
    "replies",
    "technical",
    "design_concepts",
    "nitpicky",
    "agent_decides_approvals",
    "ask_open_questions",
    "experimental_approvals",
  ],
};

// The model setting and output budget the coordinator runs on, as a plugin declares its roles'.
export const COORDINATOR_SETTING: ModelSetting = {
  label: "Coordinator",
  hint: "Talks with you and plans the work.",
  tier: "medium",
};
export const COORDINATOR_BUDGET: OutputBudget = { maxOutputTokens: 24576 };
