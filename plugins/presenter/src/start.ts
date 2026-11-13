import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import {
  Refusal,
  type Filed,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import {
  buildPackageAssignment,
  presenterAssignmentMessage,
  type PackageAssignment,
  type PresenterAssignmentInput,
} from "./personas.ts";

const Present = type({
  audience: "string",
  decisionNeeded: "string",
  kinds: "string[]",
  tone: "string",
  length: "string",
  instruction: "string",
});

// The documents the deck covers, each read at its current version, and the chosen design's tokens.
async function presented(
  input: typeof Present.infer,
  { versions, read, design }: Filed,
): Promise<PresenterAssignmentInput> {
  const documents = await Promise.all(
    [...new Set(input.kinds)].map(async (kind) => {
      const version = versions.get(kind);
      if (!version)
        throw new Refusal(
          `${kind}_not_filed: write and file the ${kind} first`,
        );
      const { title, content } = await read(version);
      return { ...version, kind, title, content };
    }),
  );
  const chosen = versions.get("design");
  const tokens = chosen && (await design(chosen));
  return {
    audience: input.audience,
    decisionNeeded: input.decisionNeeded,
    tone: input.tone,
    length: input.length,
    instruction: input.instruction,
    documents,
    ...(chosen && tokens
      ? {
          design: {
            ...chosen,
            kind: "design",
            title: tokens.title,
            designMd: tokens.tokens,
            ...(tokens.styles === undefined
              ? {}
              : { stylesCss: tokens.styles }),
          },
        }
      : {}),
  };
}

// A package is filed only from sources at the version the person approved, the chosen design's
// included, unless they leave document approvals to Builder.
function approvedOnly(
  { sources }: PackageAssignment,
  filed: Filed,
  asksApprovals: boolean,
) {
  const unapproved = sources.find(
    ({ kind, version }) =>
      (kind === "design" || asksApprovals) && filed.approved(kind) !== version,
  );
  if (unapproved)
    throw new Refusal(
      `${unapproved.kind}_not_approved: the person approves the current ${unapproved.kind} before a deck shows it`,
    );
}

// One presenter per audience. The manifest holds the deck back until each document it covers is
// approved; a design is in the deck only once the person chose it. The run keeps the assignment,
// its sources pinned, as its record before it is told about it.
export default defineStarter(
  type({ "+": "reject", workflow: "'presenter'" }),
  Present,
  async ({ workflow }, input, project: Project) => {
    const { facts, asksApprovals } = await project.state();
    return {
      runs: [
        await project.deploy({
          workflow,
          correlation: "presenter-" + input.audience,
          assignment: async (filed) => {
            if (filed.versions.has("design") && !facts.has("design_chosen"))
              throw new Refusal(
                "design_not_chosen: the person chooses the design before a deck shows it",
              );
            return presenterAssignmentMessage(await presented(input, filed));
          },
          keep: async (filed) => {
            const assignment = buildPackageAssignment(
              await presented(input, filed),
            );
            approvedOnly(assignment, filed, asksApprovals);
            return { record: { assignment } };
          },
        }),
      ],
      notStarted: [],
    };
  },
);
