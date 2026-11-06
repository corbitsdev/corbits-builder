import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Markdown } from "./markdown.tsx";

const SAMPLE = `## Problem

Small bakeries lose orders because they take them by phone and write them on paper.

### Who has it

- Owners who bake and serve at once
- Staff who **answer the phone** mid-shift
- [x] Interviewed three bakeries
- [ ] Priced an order tablet

### Sources

See the [interview notes](document:interview_notes) and \`orders.csv\`.

> Half of Saturday's cake orders came in after noon.

| Day | Orders | Missed |
| --- | --- | --- |
| Friday | 41 | 3 |
| Saturday | 66 | 9 |
`;

const meta = {
  title: "Components/Markdown",
  component: Markdown,
  args: { source: SAMPLE },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A `document:` link shows as its words. */
export const Document: Story = {};

/** A `document:` link opens the document. */
export const WithDocumentLinks: Story = {
  args: { openDocument: fn() },
};
