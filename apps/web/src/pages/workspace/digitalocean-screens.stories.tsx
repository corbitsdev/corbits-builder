import type { Meta, StoryObj } from "@storybook/react-vite";
import digitalocean from "@plugins/digitalocean/package.json";
import accountDefinition from "@plugins/digitalocean/src/account/definition.ts";
import AccountView from "@plugins/digitalocean/src/account/view.tsx";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

export const accountScreen = storyScreen(
  "@corbits-builder/digitalocean account",
  digitalocean.builder.actions["account"],
  { screen: accountDefinition, view: AccountView, data: undefined },
);

const meta = {
  title: "Screens/Plugins/DigitalOcean",
  component: ScreenStory,
  args: {
    screen: accountScreen,
    state: "open",
    input: {},
    project: {},
    output: {
      size: "s-1vcpu-1gb",
      region: "fra1",
      monthly: 6,
      team: { id: "team-1", name: "Bakery" },
    },
  },
} satisfies Meta<typeof ScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first time: choose the size and where it runs, each size with its monthly price, then sign in. */
export const Account: Story = {};

/** DigitalOcean quoted a different price for the smallest size, and the screen shows that one. */
export const AccountAfterPriceChanged: Story = {
  args: {
    project: { "digitalocean.quote": { size: "s-1vcpu-1gb", monthly: 7 } },
  },
};

/** A server exists and costs money, so the screen only signs the person in again. */
export const SignedOutWithServer: Story = {
  args: {
    project: {
      "publish.holding": {
        target: "digitalocean",
        place: "DigitalOcean",
        since: "2026-11-18T09:00:00.000Z",
        costs: "$6 a month",
      },
    },
  },
};

export const Chosen: Story = { args: { state: "answered" } };

export const SignedInAgain: Story = {
  args: { state: "answered", output: { signedIn: true } },
};
