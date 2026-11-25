import { defineScreen, type Offer } from "@corbits-builder/plugin";
import type { ReviewedDesign } from "@corbits-builder/plugin-ui/screen";
import { Input, Output, type Comment } from "./schema.ts";

/** Approving the design with the comments that have words, or sending them back. */
export const offerOf = (
  { version, approval }: ReviewedDesign,
  drafted: readonly (typeof Comment.infer)[] = [],
): Offer<typeof Output.infer> => {
  const comments = drafted.filter((comment) => comment.text.trim().length > 0);
  return {
    accept:
      "option" in approval
        ? {
            output: {
              decision: "approved",
              version,
              option: approval.option,
              comments,
            },
          }
        : approval,
    sendBack: { decision: "changes", version, comments },
  };
};

export default defineScreen({
  places: {
    "main-pane": {},
    "prompt-box": {
      size: "sm",
      reply: "Say what should change, or tag a place in the mockup.",
      decision: {
        accept: "Approve",
        sendBack: {
          note: "message",
          items: "comments",
          one: "comment",
          many: "comments",
        },
        offer: ({
          resources: { design },
          draft,
        }: {
          resources: { design: ReviewedDesign | null };
          draft: Partial<typeof Output.infer>;
        }) => (design === null ? undefined : offerOf(design, draft.comments)),
      },
    },
  },
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    says: {
      label: () => "Review the mockup",
      chose: (output) =>
        output.decision === "approved" ? "Approved" : "Changes asked for",
    },
    summary:
      'Opens the design\'s clickable mockup over the whole page, where the person tries it, comments on places in it, and approves the design or asks for changes. Builder shows the newest design itself, the live draft while a designer works; do not pass it. The answer is { decision: "approved" }, and Builder has then filed the approved option as the design. Or it is { decision: "changes", comments, message } for the designer, each comment naming the place it points at.',
    when: "The design is ready for the person to look at, or needs their approval.",
    unless: "The person only asked a question about the design.",
    fields: {
      note: {
        about:
          "A short line telling the person what to look at in this version, such as what changed since their last comments. Leave out when there is nothing to point at.",
      },
    },
  },
  approves: (output) =>
    output.decision === "approved" &&
    output.option !== undefined &&
    output.version !== "draft"
      ? [{ artifactId: output.option, version: output.version }]
      : [],
});
