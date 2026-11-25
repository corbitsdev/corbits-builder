import { defineScreen, type Offer } from "@corbits-builder/plugin";
import type { ShownDocument } from "@corbits-builder/plugin-ui/screen";
import { Input, Output } from "./schema.ts";

/** What the host supplies the screen: the project's filed documents. */
export type Host = {
  documents: { list: readonly ShownDocument[] };
};

/** The documents asked for that are filed, and the kinds asked for that are not. */
export function filedOf(
  list: readonly ShownDocument[],
  kinds: readonly string[],
) {
  const filed = list.filter((document) => kinds.includes(document.kind));
  const missing = kinds.filter(
    (kind) => !filed.some((document) => document.kind === kind),
  );
  return { filed, missing };
}

/** Approving every document asked for at the version shown, once all are filed. */
export function offerOf(
  list: readonly ShownDocument[],
  kinds: readonly string[],
): Offer<typeof Output.infer> {
  const { filed, missing } = filedOf(list, kinds);
  if (missing.length > 0)
    return {
      accept: { unavailable: "Each document is approved once it is filed." },
    };
  return {
    accept: {
      output: {
        approved: filed.map(({ kind, artifactId, version }) => ({
          kind,
          artifactId,
          version,
        })),
      },
    },
  };
}

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    says: {
      // Each document by its own kind, so any document reads by name, such as the user manual.
      label: (input) =>
        `Approve the ${input.kinds.map((kind) => kind.replaceAll("_", " ")).join(" and ")}`,
      chose: () => "Approved",
    },
    summary:
      "Puts filed documents in front of the person to approve, each at its current version, with a way to open each. The answer is { approved: [{ kind, artifactId, version }] }, and Builder has then recorded the approval of exactly those versions; if they write back instead, what they wrote is their answer.",
    when: "A document the person asked for, or one a plan step waits on, is filed with no open questions left. Open it as soon as it is filed, without asking first and after a sentence or two rather than retelling it, because the screen is how they read it and send it back.",
    unless:
      "The person chose to let you decide approvals, or the work is a change to something already built.",
    fields: {
      kinds: {
        about:
          "The filed documents to approve, by kind. One screen covers every document ready for the person, so list them all together.",
        choices: {
          problem_brief: "the problem brief",
          constraints: "the constraints",
          approaches: "the approaches",
          product_requirements: "the product requirements",
          build_plan: "the build plan",
        },
        otherwise:
          "Or the kind of any other filed document, as read_artifact lists it.",
      },
    },
  },
  places: {
    "prompt-box": {
      size: "md",
      reply: "Or type what should change…",
      decision: {
        accept: "Approve",
        offer: ({
          input,
          resources,
        }: {
          input: typeof Input.infer;
          resources: Host;
        }) => offerOf(resources.documents.list, input.kinds),
      },
    },
  },
  approves: (output) =>
    output.approved.map(({ artifactId, version }) => ({ artifactId, version })),
});
