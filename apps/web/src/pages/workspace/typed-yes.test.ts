import { expect, test } from "bun:test";
import {
  chooseApproachWithOpenApproval,
  deliverWithOpenApproval,
  isAffirmation,
} from "./typed-yes.tsx";

test("only a whole plain affirmation approves", () => {
  for (const message of [
    "yes",
    "Yes!",
    "  OK. ",
    "go ahead",
    "Ship it!!",
    "LGTM",
    "sounds good.",
  ])
    expect(isAffirmation(message)).toBe(true);
  for (const message of [
    "yes but change the title",
    "no",
    "not ok",
    "okay?then wait",
    "",
    "yess",
  ])
    expect(isAffirmation(message)).toBe(false);
});

test("sending a message while a coordinator approval is open denies it first", async () => {
  const steps: string[] = [];
  const sent = await deliverWithOpenApproval({
    openApprovalId: "appr-design",
    decide: async (decision) => {
      steps.push(`decide:${decision.approvalId}:${decision.choice}`);
      return null;
    },
    deliver: async () => {
      steps.push("deliver");
      return true;
    },
  });
  expect(sent).toBe(true);
  expect(steps).toEqual(["decide:appr-design:no", "deliver"]);
});

test("a message sent while a coordinator approval is open is the decline's reason, not separate mail", async () => {
  const steps: string[] = [];
  const sent = await deliverWithOpenApproval({
    openApprovalId: "appr-brief",
    decide: async () => {
      steps.push("decide");
      return null;
    },
    deliver: async () => {
      steps.push("deliver");
      return true;
    },
    decline: async (approvalId) => {
      steps.push(`decline:${approvalId}`);
      return true;
    },
  });
  expect(sent).toBe(true);
  expect(steps).toEqual(["decline:appr-brief"]);
});

test("sending a message when no coordinator approval is open delivers directly", async () => {
  const steps: string[] = [];
  const sent = await deliverWithOpenApproval({
    openApprovalId: undefined,
    decide: async () => {
      steps.push("decide");
      return null;
    },
    deliver: async () => {
      steps.push("deliver");
      return true;
    },
  });
  expect(sent).toBe(true);
  expect(steps).toEqual(["deliver"]);
});

test("a failed denial stops before delivering the message", async () => {
  const steps: string[] = [];
  const sent = await deliverWithOpenApproval({
    openApprovalId: "appr-design",
    decide: async () => {
      steps.push("decide");
      return "That decision was not saved.";
    },
    deliver: async () => {
      steps.push("deliver");
      return true;
    },
  });
  expect(sent).toBe(false);
  expect(steps).toEqual(["decide"]);
});

test("choosing an approach declines an open ask with the choice as its reason", async () => {
  const unrelatedSteps: string[] = [];
  const unrelatedFault = await chooseApproachWithOpenApproval({
    openApprovalId: "appr-design",
    deliver: async () => {
      unrelatedSteps.push("deliver");
      return true;
    },
    decline: async (approvalId) => {
      unrelatedSteps.push(`decline:${approvalId}`);
      return true;
    },
    notSent: "not sent",
  });
  expect(unrelatedFault).toBeNull();
  expect(unrelatedSteps).toEqual(["decline:appr-design"]);
});

test("sending attached files while a coordinator approval is open denies it before attaching materials", async () => {
  const steps: string[] = [];
  const attached = await deliverWithOpenApproval({
    openApprovalId: "appr-brief",
    decide: async (decision) => {
      steps.push(`decide:${decision.approvalId}:${decision.choice}`);
      return null;
    },
    deliver: async () => {
      steps.push("attachMaterials");
      return true;
    },
  });
  expect(attached).toBe(true);
  expect(steps).toEqual(["decide:appr-brief:no", "attachMaterials"]);

  const failedSteps: string[] = [];
  const notAttached = await deliverWithOpenApproval({
    openApprovalId: "appr-brief",
    decide: async (decision) => {
      failedSteps.push(`decide:${decision.approvalId}:${decision.choice}`);
      return "That decision was not saved.";
    },
    deliver: async () => {
      failedSteps.push("attachMaterials");
      return true;
    },
  });
  expect(notAttached).toBe(false);
  expect(failedSteps).toEqual(["decide:appr-brief:no"]);
});
