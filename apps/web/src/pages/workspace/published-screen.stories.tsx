import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import {
  valueIn,
  type ProjectRead,
  type StepStatus,
} from "@corbits-builder/plugin";
import published, { text } from "@plugins/publish/src/published/definition.ts";
import PublishedView from "@plugins/publish/src/published/view.tsx";

const RELEASE = {
  target: "server",
  url: "http://203.0.113.7",
  version: "abc123",
  at: "2026-11-17T10:00:00.000Z",
};
const GO_AHEAD = { plan: "publish-to-server", at: "2026-11-18T10:00:00.000Z" };

// The places installed to publish to, as the hub offers them.
const PLACES = [
  {
    handle: "publish-to-server",
    about:
      "Your own server: one you already rent. Your hosting provider bills you.",
    when: "The person wants it on a server of their own.",
  },
  {
    handle: "publish-to-host",
    about:
      "Example Host: a secure (https) web address of its own. Free to start, and no account needed.",
    when: "The person wants it on a hosting service.",
  },
];

// What the place's removal tells the person before they agree to it.
const REMOVES =
  "Your app stops answering at its address. What people entered in the app stays on your server, and comes back if you publish again.";

/** The project as the hub reads it for the screen's state: its values, saved app, facts and plan. */
const projectOf = (
  values: Record<string, unknown>,
  plan: readonly StepStatus[],
  appVersion: string,
): ProjectRead => ({
  value: (value) => valueIn(values, value),
  appVersion,
  confirm: () => REMOVES,
  facts: new Set(["app_exists"]),
  plan,
  plans: () => PLACES,
});

function PublishedScreen({
  values,
  plan = [],
  appVersion = RELEASE.version,
}: {
  values: Record<string, unknown>;
  plan?: readonly StepStatus[];
  appVersion?: string;
}) {
  const state = published.state?.(projectOf(values, plan, appVersion));
  if (state === undefined) return null;
  return (
    <PublishedView
      prepared={{
        input: {},
        data: state,
        project: {},
        facts: [],
        resources: undefined,
      }}
      draft={{}}
      setDraft={() => {}}
      submit={async () => {}}
      submitting={false}
      fault={undefined}
      place="card"
      answer={undefined}
      act={async () => {}}
    />
  );
}

const meta = {
  title: "Screens/Plugins/Publish/Published",
  component: PublishedScreen,
  args: { values: {} },
} satisfies Meta<typeof PublishedScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Never published: where it can go, and Publish once a place is picked. */
export const NeverPublished: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText(text.title.never)).toBeVisible();
    await userEvent.click(canvas.getAllByRole("radio")[0]!);
    await expect(
      canvas.getByRole("button", { name: text.publish }),
    ).toBeEnabled();
  },
};

/** The person pressed Publish and it has not gone out yet. */
export const Publishing: Story = {
  args: { values: { "publish.go-ahead": GO_AHEAD } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(text.title.publishing)).toBeVisible();
  },
};

const PUBLISHED = {
  "publish.release": RELEASE,
  "publish.plan": "publish-to-server",
  "publish.holding": {
    target: "server",
    place: "Example Cloud",
    since: "2026-11-17T09:00:00.000Z",
    costs: "$6 a month",
  },
};

/** The release is recorded after the go-ahead: published, though the publisher's run carries on. */
export const LiveWhileRunning: Story = {
  args: {
    values: {
      "publish.go-ahead": GO_AHEAD,
      "publish.plan": "publish-to-server",
      "publish.release": {
        target: "server",
        url: RELEASE.url,
        version: RELEASE.version,
        at: "2026-11-18T10:01:00.000Z",
      },
    },
    plan: [
      {
        plugin: "server",
        action: "publish",
        plan: "publish-to-server",
        state: "running",
        summary: "read_skill codes",
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(text.title.published)).toBeVisible();
    await expect(canvas.queryByText("read_skill codes")).toBeNull();
  },
};

/** Published: the address, when, what it costs, and Take it down. */
export const Published: Story = {
  args: { values: PUBLISHED },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link")).toHaveAttribute(
      "href",
      RELEASE.url,
    );
    await expect(canvas.queryByRole("button", { name: text.gone })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: text.publishChanges }),
    ).toBeNull();
  },
};

/** The saved app is newer than the published one: Publish changes. */
export const Changes: Story = {
  args: { values: PUBLISHED, appVersion: "def456" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: text.publishChanges }),
    ).toBeEnabled();
  },
};

/** Published at a host without an account: Keep it, until when, and I kept it. */
export const Keep: Story = {
  args: {
    values: {
      "publish.release": {
        target: "host",
        url: "https://quiet-river.example.com",
        version: RELEASE.version,
        at: RELEASE.at,
        replaceable: false,
      },
      "publish.plan": "publish-to-host",
      "publish.keep": {
        link: "https://example.com/claim",
        until: "2099-11-20T10:00:00.000Z",
        place: "Example Host",
      },
    },
    appVersion: "def456",
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: text.keep.open("Example Host") }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: text.keep.kept }),
    ).toBeEnabled();
  },
};

/** Take it down asks on the screen itself, in the place's own words. */
export const TakeDownConfirm: Story = {
  args: { values: PUBLISHED },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: text.takeDown.ask }),
    );
    await expect(canvas.getByText(REMOVES)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: text.takeDown.yes }),
    ).toBeEnabled();
  },
};

/** The publish the person agreed to failed: why, and Try again. */
export const Failed: Story = {
  args: {
    values: {
      "publish.go-ahead": GO_AHEAD,
      "publish.plan": "publish-to-server",
    },
    plan: [
      {
        plugin: "server",
        action: "publish",
        plan: "publish-to-server",
        state: "failed",
        summary: "The server did not answer on port 22.",
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The server did not answer on port 22.",
    );
    await expect(
      canvas.getByRole("button", { name: text.again }),
    ).toBeEnabled();
  },
};

/** The person confirmed Take it down and the removal is under way. */
export const TakingDown: Story = {
  args: {
    values: {
      "publish.release": RELEASE,
      "publish.take-down": { target: "server", release: RELEASE.at },
    },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(text.title["taking-down"]),
    ).toBeVisible();
  },
};

/** Taken down: nothing is published or held, and it can be published again. */
export const TakenDown: Story = {
  args: {
    values: {
      "publish.plan": "publish-to-server",
      "publish.take-down": { target: "server", release: RELEASE.at },
    },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(text.title["taken-down"]),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: text.publish }),
    ).toBeEnabled();
  },
};
