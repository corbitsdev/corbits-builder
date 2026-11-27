import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationQuestion } from "@corbits-builder/schemas/conversation";
import type { ChatMessage } from "../../api/types.ts";
import type { OpenApproval } from "./collaboration.ts";
import { useDelivery } from "./delivery.model.ts";

type Input = Parameters<typeof useDelivery>[0];

const question: ConversationQuestion = {
  signalName: "signal-1",
  at: 1,
  status: "open",
  asked: {
    questions: [
      {
        id: "q1",
        question: "Which day?",
        header: "Day",
        options: [],
        multiple: false,
        custom: true,
      },
    ],
  },
};

const approval: OpenApproval = {
  approvalId: "approval-1",
  tenantId: "tenant-1",
};

/** The room as the person types into it, recording where their words went. */
function room({
  openQuestion,
  approvals = [],
}: {
  openQuestion?: ConversationQuestion;
  approvals?: OpenApproval[];
}) {
  const answered: [string, unknown][] = [];
  const mailed: { body: string; declined: boolean }[] = [];
  const decided: string[] = [];
  const box: string[] = [];
  const composer = {
    text: "",
    setText: (text: string) => box.push(text),
    inputRef: { current: null },
    sending: false,
    mail: async (
      body: string,
      _clear?: boolean,
      send?: (words: string) => Promise<ChatMessage>,
    ) => {
      mailed.push({ body, declined: send !== undefined });
      return true;
    },
    sendFiles: async () => true,
    box: { attachments: { files: [] } },
    restore: () => {},
  } as unknown as Input["composer"];
  const decisions: Input["decisions"] = {
    pendingApprovals: approvals,
    readPendingApprovals: async () => approvals,
    onDecideApproval: async ({ approvalId }) => {
      decided.push(approvalId);
      return null;
    },
    declineWith: () => async () => {
      throw new Error("A test decline is never posted.");
    },
  };
  let delivery: ReturnType<typeof useDelivery> | undefined;
  function Probe() {
    delivery = useDelivery({
      composer,
      question: {
        openQuestion,
        answer: async (signalName, given) => {
          answered.push([signalName, given]);
          return true;
        },
      },
      decisions,
      composerDisabled: false,
    });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (delivery === undefined) throw new Error("Delivery hook did not render");
  return { delivery, answered, mailed, decided, box };
}

describe("where the person's words go", () => {
  test("while the coordinator waits on its question, they answer it", async () => {
    const { delivery, answered, mailed, box } = room({
      openQuestion: question,
    });
    expect(await delivery.deliver("  Saturday  ", true)).toBe(true);
    expect(answered).toEqual([["signal-1", { reply: "Saturday" }]]);
    expect(mailed).toEqual([]);
    expect(box).toEqual([""]);
  });

  test("while an approval is open, they go as the reason it is declined", async () => {
    const { delivery, mailed, decided } = room({ approvals: [approval] });
    expect(await delivery.deliver("Use the other address")).toBe(true);
    expect(mailed).toEqual([{ body: "Use the other address", declined: true }]);
    expect(decided).toEqual([]);
  });

  test("with nothing waiting on the person, they go to the coordinator", async () => {
    const { delivery, mailed, answered } = room({});
    expect(await delivery.deliver("Add a contact page")).toBe(true);
    expect(mailed).toEqual([{ body: "Add a contact page", declined: false }]);
    expect(answered).toEqual([]);
  });
});
