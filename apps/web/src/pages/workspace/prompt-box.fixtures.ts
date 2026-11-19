/** The prompt box as the stories of the box and of the chat around it start from. */
import { createRef } from "react";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import type { PromptQuestion } from "@corbits-builder/schemas/conversation";
import type { RoomComposer } from "./room.view.tsx";

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
  caution: false,
  onSendAnyway: fn(),
  onCancelCaution: fn(),
  suggestedReplies: [],
  onReply: fn(),
  sendLabel: null,
  status: null,
  onStop: fn(),
};

export const working: ComposerDock = {
  ...composer,
  working: true,
  status: {
    state: "working",
    label: "Writing Approaches",
    action: wording.promptBox.pill.watch,
  },
};

/** The coordinator's open question, as the box carries it while it waits on the person. */
export const question: PromptQuestion = {
  at: 0,
  signalName: "prompt-box-question",
  status: "open",
  asked: {
    questions: [
      {
        id: "audience",
        header: "Audience",
        question: "Who is it for?",
        options: [
          {
            label: "Bakery owners (Recommended)",
            description: "They take the orders and plan the day's baking.",
          },
          {
            label: "Counter staff",
            description: "They serve customers at the counter.",
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
