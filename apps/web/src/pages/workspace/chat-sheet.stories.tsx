import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Message, MessageContent, TypingIndicator } from "@corbits/react-ui";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { PullHandle } from "./chat-sheet.tsx";
import { composer, working } from "./prompt-box.fixtures.ts";
import room from "./index.module.css";
import { RoomDockView } from "./room.view.tsx";

/** The conversation behind the box, drawn with the thread's own message parts. */
const conversation = (
  <>
    <Message from="own">
      <MessageContent text="Compare a few ways the shop could take orders" />
    </Message>
    <Message from="agent">
      <MessageContent text="Constraints are set: two people, one counter, orders by phone and text. Next, three ways to take orders that fit them." />
    </Message>
  </>
);

/** The same conversation while work runs: its newest line is the thread's thinking mark. */
const whileWorking = {
  dock: working,
  chat: (
    <>
      {conversation}
      <Message from="agent" status="streaming">
        <TypingIndicator />
      </Message>
    </>
  ),
};

// A stand-in for the page the box sits under: a document in the room's own page, which hides
// everything but the box while the chat is full screen.
function Page({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "relative", height: "100vh" }}>
      <div className={room.page} style={{ background: "var(--wb-frame)" }}>
        <div className={room.pageScreen} style={{ overflow: "auto" }}>
          <article
            style={{
              width: "min(640px, calc(100% - 32px))",
              margin: "64px auto 0",
              padding: "40px 64px",
              flex: 1,
              background: "var(--wb-pane)",
              color: "var(--wb-foreground)",
            }}
          >
            <h1 style={{ fontSize: 30, fontWeight: 600, margin: "0 0 10px" }}>
              Problem brief
            </h1>
            <p>
              Small bakeries take cake orders by phone and on paper, and lose
              some of them on busy days.
            </p>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 24 }}>
              Who has it
            </h2>
            <ul>
              <li>Owners who bake and serve at once</li>
              <li>Counter staff who answer the phone mid-shift</li>
              <li>Regulars who order the same cake every month</li>
            </ul>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 24 }}>
              What it must do
            </h2>
            <ul>
              <li>
                Take a cake order online: size, flavour, message and pickup
              </li>
              <li>Flag allergies and dietary needs on every order</li>
              <li>Tell the customer when their cake is ready</li>
            </ul>
          </article>
        </div>
        {children}
      </div>
    </div>
  );
}

type Args = Parameters<typeof RoomDockView>[0];

const brief = { title: "Problem brief", version: "Version 2" };

function Screen(args: Args) {
  const dock = args.dock.kind === "composer" ? args.dock : composer;
  const [text, setText] = useState(dock.text);
  return (
    <Page>
      <RoomDockView
        {...args}
        dock={{ ...dock, text, onTextChange: setText }}
        // Full screen names the page above, from whichever state it was taken to.
        chatStart={{ returnTo: brief, ...args.chatStart }}
      />
    </Page>
  );
}

const meta = {
  title: "Screens/Workspace/Chat sheet",
  component: RoomDockView,
  parameters: { layout: "fullscreen" },
  args: { dock: composer, chat: conversation },
  render: (args) => <Screen {...args} />,
} satisfies Meta<typeof RoomDockView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing running: only the handle above the box. Drag it up, or press it, to see the chat. */
export const NothingRunning: Story = {};

/** Pulling up: only the handle and the newest line, the work in progress, have come into view. */
export const PullingUp: Story = {
  args: { ...whileWorking, chatStart: { defaultPull: 40 } },
};

/** Further into the pull: earlier lines fade out under the sheet's top edge rather than being cut by it. */
export const MidPull: Story = {
  args: { ...whileWorking, chatStart: { defaultPull: 150 } },
};

/** Chat open: the newest message is the work in progress. Pull it down and the pill comes back. */
export const ChatOpen: Story = {
  args: { ...whileWorking, chatStart: { defaultState: "open" } },
};

/** Full screen: only the way back down, and the page the person left named at the top. */
export const FullScreen: Story = {
  args: {
    ...whileWorking,
    chatStart: { defaultState: "full" },
  },
};

/** Escape puts the chat back and the pill returns. */
export const EscapeCloses: Story = {
  args: { ...whileWorking, chatStart: { defaultState: "open" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("log")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(
      canvasElement.querySelector('[data-slot="chat-history"]'),
    ).not.toBeVisible();
    // The pill fades back in, so it is looked for once the fade is done.
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="pill"]')).toBeVisible(),
    );
  },
};

/** Pressing the pill opens the chat, and the handle on the sheet puts it back. */
export const PressToOpen: Story = {
  args: whileWorking,
  play: async ({ canvasElement }) => {
    const pillButton =
      canvasElement.querySelector<HTMLElement>('[data-slot="pill"]');
    if (pillButton === null) throw new Error("No pill");
    await userEvent.click(pillButton);
    await expect(within(canvasElement).getByRole("log")).toBeVisible();
  },
};

/** At phone width the sheet keeps its even inset around the box. */
export const Narrow: Story = {
  args: { ...whileWorking, chatStart: { defaultState: "open" } },
  globals: { viewport: { value: "mobile1" } },
  decorators: [
    (Story) => (
      <div style={{ width: 375, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
};

/** Focus on the handle from the keyboard: its ring is blue, as every ring by the box is. */
export const HandleFocused: Story = {
  play: async ({ canvasElement }) => {
    const handle = canvasElement.querySelector<HTMLElement>(
      '[data-slot="pull-handle"]',
    );
    // A simulated Tab moves focus without the ring a real one shows, so ask for the ring.
    handle?.focus({ focusVisible: true });
    await expect(handle).toHaveFocus();
  },
};

export const DarkHandleFocused: Story = {
  ...HandleFocused,
  globals: { mode: "dark" },
};

export const DarkOpen: Story = {
  args: { ...whileWorking, chatStart: { defaultState: "open" } },
  globals: { mode: "dark" },
};

export const DarkNothingRunning: Story = {
  globals: { mode: "dark" },
};

/** The handle at rest and while held. */
export const Handle: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
      {(["rest", "dragging"] as const).map((state) => (
        <PullHandle key={state} state={state} expanded={false} onPress={fn()} />
      ))}
    </div>
  ),
};
