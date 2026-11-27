import { canDrop, defineScreen } from "@corbits-builder/plugin";
import { Input, Output } from "./schema.ts";

export const text = {
  title: "Confirm your change of plans",
  goal: "Builder will pursue your new goal:",
  stops: "The following steps will be canceled:",
  nothing: "Nothing on the plan is left to cancel.",
  go: "Confirm",
  keep: "Keep current plan",
  went: "Yes, cancel those steps",
  kept: "No, keep the current plan",
  orWrite: "Or write below what you want instead.",
};

export default defineScreen({
  input: Input,
  output: Output,
  // The steps are named as the plan names them, not as the coordinator put it.
  fromProject: ({ stepIds, instead }, project) => ({
    stops: project.plan.flatMap(({ id, title, state }) =>
      stepIds.includes(id) && canDrop(state) ? [{ id, title }] : [],
    ),
    instead,
  }),
  describe: {
    says: {
      label: () => text.title,
      chose: ({ agreed }) => (agreed === null ? text.kept : text.went),
    },
    summary:
      "Puts a change of direction to the person before any work the plan still holds is dropped: the steps that stop, by their titles on the plan, and the new goal you will pursue, with one button to confirm and one to keep the plan. The answer { agreed: [stepIds] } is their go-ahead to stop exactly the steps they were shown: Builder has then cancelled those steps and stopped any still running, and you may take them out of the plan and carry on with what you said. { agreed: null } means they keep the plan, and nothing changed. If they write back instead, what they wrote is their answer and no step was cancelled. When what they wrote agrees to the change, open this screen again.",
    when: "The person wants to go a different way while a plan is under way, or to drop a step that waits for their approval, and the plan refused to let you take those steps out. Their yes here is the only thing that lets you.",
    unless:
      "The change only adds steps, redoes a step, stops a job or skips an optional step; none of those drops work the plan holds.",
    fields: {
      stepIds: {
        about:
          "The ids of the plan steps to stop, as the plan lists them: every step the new direction leaves out that is not done.",
      },
      instead: {
        about:
          "The person's new goal only, as a short phrase the person reads after the words pursue your new goal, such as a printable sign-out sheet for the workshop wall. Leave out what stops: the screen lists those steps itself.",
      },
    },
  },
  cancels: ({ agreed }) => agreed ?? [],
});
