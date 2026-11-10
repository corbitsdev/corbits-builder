import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  Banner,
  BannerAction,
  Button,
  Mark,
  QuietSelect,
  QuietState,
  StateLabel,
} from "./components.tsx";
import { notify } from "./notice.ts";

const TONES = [
  "success",
  "okay",
  "warning",
  "error",
  "selected",
  "info",
  "loading",
  "disabled",
] as const;

const meta = {
  title: "Components/Primitives",
} satisfies Meta;

export default meta;

export const StateLabels: StoryObj = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {TONES.map((tone) => (
        <StateLabel key={tone} tone={tone}>
          {tone}
        </StateLabel>
      ))}
    </div>
  ),
};

export const QuietStates: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 8 }}>
      {TONES.map((tone) => (
        <QuietState key={tone} tone={tone}>
          {tone}
        </QuietState>
      ))}
    </div>
  ),
};

export const Buttons: StoryObj<typeof Button> = {
  args: { children: "Continue", onClick: fn() },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "primary",
        "secondary",
        "outline",
        "ghost",
        "link",
        "destructive",
      ],
    },
  },
  render: (args) => <Button {...args} />,
};

export const ButtonVariants: StoryObj = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {(
        [
          "primary",
          "secondary",
          "outline",
          "ghost",
          "link",
          "destructive",
        ] as const
      ).map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
      <Button loading>loading</Button>
      <Button disabled title="Nothing to send yet">
        disabled
      </Button>
    </div>
  ),
};

export const BlockButton: StoryObj = {
  render: () => (
    <div style={{ width: 320 }}>
      <Button variant="primary" block>
        Sign in
      </Button>
    </div>
  ),
};

export const Banners: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <Banner title="The model provider is slow to answer.">
        Replies may take longer than usual.
      </Banner>
      <Banner
        tone="error"
        role="alert"
        title="The model provider refused the key."
      >
        Check the key in settings, then try again.
        <BannerAction>
          <Button onClick={fn()}>Open settings</Button>
        </BannerAction>
      </Banner>
      <Banner tone="okay" title="Connected." />
    </div>
  ),
};

export const Marks: StoryObj<typeof Mark> = {
  args: { size: 26 },
  render: (args) => <Mark {...args} />,
};

export const QuietSelects: StoryObj = {
  render: () => (
    <QuietSelect defaultValue="list" aria-label="Library view">
      <option value="list">List</option>
      <option value="grid">Grid</option>
    </QuietSelect>
  ),
};

export const Notices: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      <Button onClick={() => notify("Saved.")}>Complete</Button>
      <Button onClick={() => notify("Saved two of three files.", false)}>
        Partial
      </Button>
      <Button
        onClick={() =>
          notify("Project archived.", true, { label: "Undo", onClick: fn() })
        }
      >
        With action
      </Button>
    </div>
  ),
};
