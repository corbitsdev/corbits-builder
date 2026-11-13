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

test.each([
  ["with a summary", "- **High water** at dusk."],
  ["without one", undefined],
])(
  "a document %s has exactly one way in, and it opens that document",
  (_, summary) => {
    const opened: string[] = [];
    const controls = pressable(
      DocumentBlock({
        kind: "tide_table_guide",
        title: "Harbour tide table guide",
        version: 2,
        summary,
        onOpen: (kind) => opened.push(kind),
      }),
    );
    expect(controls).toHaveLength(1);
    controls[0]?.onClick?.();
    expect(opened).toEqual(["tide_table_guide"]);
  },
);
