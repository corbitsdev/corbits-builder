import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ProjectValuesView } from "./project-values.view.tsx";

const meta = {
  title: "Screens/Workspace/ProjectValues",
  component: ProjectValuesView,
  args: {
    values: [
      {
        name: "brand.guidelines",
        about:
          "The brand's guidelines: voice, tone, and what to do and avoid, in the person's words, at a link they gave, or in a file they attached.",
        editors: ["text", "link", "file"],
        shown: "https://brand.example.com/guidelines",
        current: {
          editor: "link",
          draft: "https://brand.example.com/guidelines",
        },
      },
      {
        name: "stack.language",
        about:
          "The programming language the app is written in, such as TypeScript.",
        editors: ["text"],
        shown: null,
        current: null,
      },
    ],
    files: [{ artifactId: "material-1", name: "brand-book.pdf" }],
    saving: null,
    onSave: fn(),
  },
} satisfies Meta<typeof ProjectValuesView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A value that may be text, a link or a file, set to a link, and a text value not set yet. */
export const Declared: Story = {};

/** Nothing is attached yet, so a file value points the person to the paperclip. */
export const NoFiles: Story = { args: { files: [] } };

export const Loading: Story = { args: { values: "loading" } };

export const Failed: Story = { args: { values: "failed" } };
