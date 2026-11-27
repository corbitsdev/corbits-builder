/** The prompt box as the stories of the box and of the chat around it start from. */
import { createRef } from "react";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import type { PromptQuestion } from "@corbits-builder/schemas/conversation";
import type { RoomComposer } from "./prompt-box.view.tsx";

export type ComposerDock = RoomComposer & { kind: "composer" };

export const composer: ComposerDock = {
  kind: "composer",
  text: "",
  onTextChange: fn(),
  onSend: fn(),
  placeholder: wording.composer.reply,
  inputRef: createRef(),
  working: false,
  busy: false,
  disabled: false,
  needsProvider: false,
  onEnableAi: fn(),
  attachments: {
    files: [],
    accept: "text/plain,image/png",
    fault: null,
    onAdd: fn(),
    onRemove: fn(),
  },
  sendFault: null,
  restarts: null,
  suggestedReplies: [],
  onReply: fn(),
  sendLabel: null,
  status: null,
  onStop: fn(),
};

export const working: ComposerDock = {
  ...composer,
  working: true,
  status: { state: "working", label: "Writing the Problem brief" },
};

/** The coordinator's open question, as the box carries it while it waits on the person. */
export const question: PromptQuestion = {
  at: 0,
  signalName: "prompt-box-question",
  status: "open",
  asked: {
    questions: [
      {
        id: "orders",
        header: "Orders",
        question: "What will people order?",
        options: [
          {
            label: "Cakes for collection (Recommended)",
            description: "Ordered a day or more ahead.",
          },
          {
            label: "Bread for delivery",
            description: "Delivered each morning.",
          },
        ],
        multiple: false,
        custom: true,
      },
      {
        id: "audience",
        header: "Audience",
        question: "Who is this app for?",
        options: [
          {
            label: "Small teams (Recommended)",
            description: "A few people sharing the orders",
          },
          {
            label: "Freelancers",
            description: "One person working on their own",
          },
          {
            label: "Agencies",
            description: "Running orders for several shops",
          },
        ],
        multiple: false,
        custom: true,
      },
      {
        id: "devices",
        header: "Devices",
        question: "Where will people order from?",
        options: [
          { label: "Phone", description: "" },
          { label: "Desktop browser", description: "" },
        ],
        multiple: true,
        custom: false,
      },
    ],
  },
};
