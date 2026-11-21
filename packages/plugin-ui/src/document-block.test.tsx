import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { DocumentBlock } from "./document-block.tsx";

type Pressable = { children?: ReactNode; onClick?: () => void };

// Every element in the block the person can press.
function pressable(node: ReactNode): Pressable[] {
  if (Array.isArray(node)) return node.flatMap(pressable);
  if (!isValidElement<Pressable>(node)) return [];
  const own = node.props.onClick === undefined ? [] : [node.props];
  return [...own, ...pressable(node.props.children)];
}

const tideTable = {
  kind: "tide_table_guide",
  title: "Harbour tide table guide",
  version: 2,
} as const;

test.each([
  ["with a summary", { summary: "- **High water** at dusk." }],
  ["without one", { summary: undefined }],
  ["in one line", { compact: true }],
] as const)(
  "a document %s has exactly one way in, and it opens that document",
  (_, shape) => {
    const opened: string[] = [];
    const controls = pressable(
      DocumentBlock({
        ...tideTable,
        ...shape,
        onOpen: (kind) => opened.push(kind),
      }),
    );
    expect(controls).toHaveLength(1);
    controls[0]?.onClick?.();
    expect(opened).toEqual(["tide_table_guide"]);
  },
);
