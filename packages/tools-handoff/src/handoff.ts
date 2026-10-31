import { coderTaskMessage } from "@corbits-builder/coder/contract";
import {
  MATERIAL_KIND,
  DesignConcept,
} from "@corbits-builder/schemas/artifact";
import {
  AskQuestions,
  askQuestionsIssue,
} from "@corbits-builder/schemas/questions";
import { DOCUMENT_ORDER } from "./approvals.ts";
import type { HandoffConfig, HandoffScope } from "./config.ts";
import {
  DeployCoder,
  DeployWriter,
  DesignApp,
  InstructCoder,
  RequestApproval,
  ReviewArtifact,
} from "./definitions.ts";
import { inputs, refsOf, required, type ProjectHub } from "./project-hub.ts";
import {
  notApproved,
  Refusal,
  refusalText,
  startOnce,
  validArguments,
} from "./refusal.ts";

// What a hand-off needs besides its arguments: the host's config, the run's project and its hub
// routes, and the tool call it answers.
export interface HandoffDeps {
  config: HandoffConfig;
  scope: HandoffScope;
  project: ProjectHub;
  callId: string;
}

export function askQuestions(
  args: unknown,
  config: Pick<HandoffConfig, "questionsAsked">,
): string {
  const issue = askQuestionsIssue(validArguments(AskQuestions, args));
  if (issue) throw new Refusal("invalid_questions: " + issue);
  return config.questionsAsked;
}

export async function requestApproval(
  args: unknown,
  { config, project }: HandoffDeps,
) {
  const { kinds } = validArguments(RequestApproval, args);
  const { byKind, materials, openQuestions, preferences } =
    await project.listed();
  const open = [...new Set(kinds)].flatMap((kind) => {
    const count = openQuestions.get(kind);
    return count
      ? [`${kind} has ${count} open question${count > 1 ? "s" : ""}`]
      : [];
  });
  if (open.length && config.asksOpenQuestions(preferences))
    throw new Refusal(
      "open_questions: " +
        open.join(", ") +
        "; read_artifact shows each one's openQuestions to put to the person with ask_questions, and the document revised with their answers can then be approved",
    );
  const documents = [...new Set(kinds)].flatMap((kind) => {
    if (kind !== MATERIAL_KIND) return [{ kind, ...required(byKind, kind) }];
    if (!materials.length)
      throw new Refusal(
        "material_not_filed: the project has no material to approve",
      );
    return materials;
  });
  await project.recordApproval("request_approval", documents);
  return { approved: documents };
}

export async function deployWriter(
  args: unknown,
  { config, scope, project }: HandoffDeps,
) {
  const input = validArguments(DeployWriter, args);
  const { byKind, approved, preferences } = await project.listed();
  const briefRef = required(byKind, "problem_brief");
  const position = DOCUMENT_ORDER.indexOf(
    input.kind as (typeof DOCUMENT_ORDER)[number],
  );
  const earlier =
    position < 0
      ? DOCUMENT_ORDER.slice(0, 1)
      : DOCUMENT_ORDER.slice(0, position);
  // An imported project may lack an earlier document that its later ones were written without.
  const writtenWithout = (index: number) =>
    DOCUMENT_ORDER.slice(index + 1).some((kind) => byKind.has(kind));
  for (const [index, kind] of earlier.entries()) {
    const ref = byKind.get(kind);
    if (!ref) {
      if (writtenWithout(index)) continue;
      throw new Refusal(
        kind +
          "_missing: " +
          (kind === "design"
            ? "have the designer make it with design_app"
            : "write and file the " + kind) +
          " before the " +
          input.kind,
      );
    }
    if (
      !config.agentDecidesApprovals(preferences) &&
      approved.get(kind) !== ref.version
    )
      throw notApproved(kind, ref.version);
  }
  const target = byKind.get(input.kind);
  const sourceRefs = [...byKind]
    .filter(
      ([kind]) =>
        !["problem_brief", "app", input.kind].includes(kind) &&
        (kind !== "design" || input.kind === "build_plan"),
    )
    .map(([, ref]) => ref);
  return project.deploy(
    "writer",
    preferences,
    "writer-" + input.kind,
    await config.assignmentToWriterMessage(
      {
        projectId: scope.projectId,
        deliverableId: input.kind,
        kind: input.kind,
        briefRef,
        sourceRefs,
        output: { expectedVersion: target?.version ?? 0 },
        instruction:
          input.kind === "build_plan"
            ? input.instruction +
              "\n\nDefault stack unless the person asked otherwise: " +
              config.defaultStack
            : input.instruction,
      },
      project.readSource,
      target,
    ),
  );
}

export async function reviewArtifact(
  args: unknown,
  { config, scope, project }: HandoffDeps,
) {
  const input = validArguments(ReviewArtifact, args);
  const { byKind, preferences } = await project.listed();
  const briefRef = required(byKind, "problem_brief");
  const target = required(byKind, input.kind);
  return project.deploy(
    "reviewer",
    preferences,
    "reviewer-" + input.kind,
    await config.assignmentToWriterMessage(
      {
        projectId: scope.projectId,
        deliverableId: input.kind,
        kind: "engineering_review",
        briefRef,
        sourceRefs: [target],
        output: { expectedVersion: target.version },
        instruction: input.instruction,
      },
      project.readSource,
    ),
  );
}

export async function deployCoder(
  args: unknown,
  { config, scope, project }: HandoffDeps,
) {
  const input = validArguments(DeployCoder, args);
  return startOnce(scope.projectId + ":coder", "coder", async () => {
    const { byKind, approved, inFlight, preferences } = await project.listed();
    for (const kind of [...config.coderInputs, "design"])
      required(byKind, kind);
    const live = inFlight.find((run) => run.role === "coder");
    if (live)
      throw new Refusal(
        "coder_already_running: the coder is building in run " +
          live.runId +
          "; send it changes with instruct_coder",
      );
    // The design is approved by choosing it, whoever decides the other documents.
    for (const kind of DOCUMENT_ORDER) {
      const { version } = required(byKind, kind);
      if (
        (kind === "design" || !config.agentDecidesApprovals(preferences)) &&
        approved.get(kind) !== version
      )
        throw notApproved(kind, version);
    }
    const design = required(byKind, "design");
    return project.deploy(
      "coder",
      preferences,
      "coder",
      config.startHere(inputs(config.coderInputs, byKind), design.version) +
        coderTaskMessage(input.instruction),
    );
  });
}

export async function instructCoder(
  args: unknown,
  { config, project, callId }: HandoffDeps,
) {
  const input = validArguments(InstructCoder, args);
  const { byKind, inFlight, preferences } = await project.listed();
  for (const kind of [...config.coderInputs, "design"]) required(byKind, kind);
  // The coder is unbounded: the live run takes the change on its warm workspace.
  const live = inFlight.find((run) => run.role === "coder");
  if (!live)
    throw new Refusal(
      "coder_not_running: no coder is building; start it with deploy_coder",
    );
  await project.recordApproval("instruct_coder", refsOf(byKind));
  await project.assign(
    live.runId,
    "coder",
    preferences,
    "coder-" + live.runId + "-" + callId,
    coderTaskMessage(input.instruction),
  );
  return { runId: live.runId, role: "coder" };
}

export async function designApp(
  args: unknown,
  { config, scope, project, callId }: HandoffDeps,
) {
  const input = validArguments(DesignApp, args);
  const { inFlight, preferences } = await project.listed();
  const limit = config.designConceptCount(preferences);
  // A requested concept already at work takes the instruction rather than adding a designer.
  const concepts = new Set(
    inFlight.flatMap((run) =>
      run.role === "designer" && run.concept ? [run.concept] : [],
    ),
  );
  for (const concept of input.concepts) concepts.add(concept.label);
  if (concepts.size > limit)
    throw new Refusal(
      "too_many_concepts: the person asked for at most " +
        String(limit) +
        " design concepts at a time",
    );
  // Each concept has its own long-lived designer.
  const design = (concept: DesignConcept) =>
    startOnce(
      scope.projectId + ":designer:" + concept.label,
      "designer",
      async () => {
        const { byKind, inFlight, preferences } = await project.listed();
        for (const kind of config.designerInputs) required(byKind, kind);
        const message =
          config.designLookIdeas(input.lookIdeas) +
          coderTaskMessage(input.instruction);
        // A designer still "deployed" never received its first assignment, so it is not reused.
        const live = inFlight.find(
          (run) =>
            run.role === "designer" &&
            run.status === "running" &&
            run.concept === concept.label,
        );
        if (live) {
          await project.assign(
            live.runId,
            "designer",
            preferences,
            "designer-" + live.runId + "-" + callId,
            message,
          );
          return {
            runId: live.runId,
            role: "designer",
            concept: concept.label,
          };
        }
        const started = await project.deploy(
          "designer",
          preferences,
          "designer",
          config.startHere(inputs(config.designerInputs, byKind)) +
            config.designConceptAssignment(concept) +
            message,
          (runId) => project.recordDesignConcept({ runId, concept }),
        );
        return { ...started, concept: concept.label };
      },
    );
  // One concept that fails to start leaves the others at work, so each reports its own outcome.
  return (await Promise.allSettled(input.concepts.map(design))).map(
    (outcome, index) =>
      outcome.status === "fulfilled"
        ? outcome.value
        : {
            concept: input.concepts[index]!.label,
            error: refusalText(outcome.reason),
          },
  );
}
