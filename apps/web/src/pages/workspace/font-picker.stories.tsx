import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { validateInput } from "@corbits-builder/plugin";
import pickFonts from "@plugins/designer/src/pick-fonts/definition.ts";
import fonts from "@plugins/designer/src/pick-fonts/data.json";
import { Fonts } from "@plugins/designer/src/pick-fonts/schema.ts";
import { FontPicker, text } from "@plugins/designer/src/pick-fonts/view.tsx";

const prepare = (
  input: Record<string, unknown>,
  project: Record<string, string>,
) => {
  const checked = validateInput(
    "designer pick-fonts",
    pickFonts,
    input,
    Fonts.assert(fonts),
    project,
  );
  if (!checked.ok || checked.prepared === undefined)
    throw new Error("The font picker's own fonts do not prepare.");
  return { input: checked.input, project, prepared: checked.prepared };
};

const inList = {
  "look.font-primary": "Inter",
  "look.font-secondary": "JetBrains Mono",
};
const browsing = prepare({}, inList);
const font = (name: string) => {
  const found = browsing.prepared.fonts.find((each) => each.name === name);
  if (found === undefined) throw new Error(`${name} is not offered.`);
  return found;
};

// Keeps the draft the way the conversation does, so a story can be clicked through.
function Drafting(props: ComponentProps<typeof FontPicker>) {
  const [draft, setDraft] = useState(props.draft);
  return (
    <FontPicker
      input={props.input}
      project={props.project}
      prepared={props.prepared}
      facts={props.facts}
      draft={draft}
      setDraft={(change) => {
        props.setDraft(change);
        setDraft((current) => Object.assign({}, current, change));
      }}
      submit={props.submit}
      submitting={props.submitting}
      answer={props.answer}
    />
  );
}

const meta = {
  title: "Screens/Workspace/FontPicker",
  component: FontPicker,
  render: (args) => <Drafting {...args} />,
  args: {
    input: browsing.input,
    project: browsing.project,
    prepared: browsing.prepared,
    facts: [],
    draft: {},
    setDraft: fn(),
    submit: fn(() => Promise.resolve()),
    submitting: false,
    answer: undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FontPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both fonts in use are in the list: the primary is changed and saved with the secondary kept. */
export const Browsing: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole("button", { name: text.keep })).toBeVisible();
    await userEvent.type(canvas.getByRole("combobox"), "fra");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(canvas.getByText(text.was("JetBrains Mono"))).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: text.change }));
    await expect(args.submit).toHaveBeenCalledWith({
      primary: font("Fraunces"),
      secondary: font("JetBrains Mono"),
    });
  },
};

const notInList = prepare(
  {},
  { "look.font-primary": "Red Hat Display", "look.font-secondary": "Inter" },
);

/** The primary in use is not in the list: its stored name shows and the main action waits until it is picked. */
export const NotInList: Story = {
  args: {
    input: notInList.input,
    project: notInList.project,
    prepared: notInList.prepared,
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      canvas.getByText(text.inUseNamed("Red Hat Display")),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: text.keep }),
    ).toBeDisabled();
    await expect(canvas.getByText(text.missing("primary"))).toBeVisible();
    await userEvent.type(canvas.getByRole("combobox"), "fraunces");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(canvas.getByRole("button", { name: text.change }));
    await expect(args.submit).toHaveBeenCalledWith({
      primary: font("Fraunces"),
      secondary: font("Inter"),
    });
  },
};

const proposal = prepare({ proposed: { primary: "Fraunces" } }, inList);
const proposalArgs = {
  input: proposal.input,
  project: proposal.project,
  prepared: proposal.prepared,
};

/** A proposal is one press; using it keeps the secondary in use. */
export const Proposal: Story = {
  args: proposalArgs,
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", {
        name: text.useProposed("Fraunces", text.sides.primary),
      }),
    );
    await userEvent.click(canvas.getByRole("button", { name: text.change }));
    await expect(args.submit).toHaveBeenCalledWith({
      primary: font("Fraunces"),
      secondary: font("JetBrains Mono"),
    });
  },
};

/** Without pressing the proposal, the fonts in use are kept as they were. */
export const ProposalDeclined: Story = {
  args: proposalArgs,
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole("combobox")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: text.keep }));
    await expect(args.submit).toHaveBeenCalledWith({
      primary: font("Inter"),
      secondary: font("JetBrains Mono"),
    });
  },
};

export const Settled: Story = {
  args: {
    answer: { primary: font("Fraunces"), secondary: font("JetBrains Mono") },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Primary Fraunces, secondary JetBrains Mono"),
    ).toBeVisible();
  },
};
