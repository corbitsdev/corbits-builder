import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import type { QuestionAnswer } from "@intx/types/signals";
import { getLogger } from "@intx/log";
import type { createArtifactService } from "../artifacts/service.ts";
import type { createPlanService } from "../plans/service.ts";
import type { createSettingsService } from "../settings/service.ts";
import type { createValueService } from "../values/service.ts";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import {
  answerQuestionAsCaller,
  mailRunAsCaller,
} from "../mail/caller-mail.ts";
import { answerRefusedText } from "../config/answers.ts";
import { openQuestion, questionClosed, screenOf } from "../plugins/question.ts";
import { errorCode, requestErrorMetadata } from "../request-error.ts";
import { CATALOG, catalogOf } from "../plugins/catalog.ts";
import { readProjectValues } from "../values/project-values.ts";
import { saveValues } from "../values/save.ts";

const log = getLogger(["corbits-builder", "hub", "answers"]);

export type AnswerOptions = {
  service: Pick<
    ReturnType<typeof createArtifactService>,
    | "projectState"
    | "claimQuestion"
    | "releaseQuestion"
    | "approveShown"
    | "saveStyleTokens"
  >;
  plans: Pick<ReturnType<typeof createPlanService>, "answerPlanStep">;
  values: Pick<ReturnType<typeof createValueService>, "saveStoredValues">;
  nativeFetch?: ((request: Request) => Promise<Response>) | undefined;
  settings?:
    | Pick<ReturnType<typeof createSettingsService>, "read" | "save">
    | undefined;
};

export function createAnswer({
  service,
  plans,
  values,
  nativeFetch,
  settings,
}: AnswerOptions) {
  // A screen's answer sets the project preferences it names, saved as Settings saves them, over the
  // project's other preferences.
  const prefer = async (
    c: Context<TenantEnv>,
    projectId: string,
    chosen: Readonly<Record<string, string>>,
  ) => {
    if (!settings) throw new ProjectError(503, "preferences_unavailable");
    const current = actorOf(c);
    const { preferences } = (await settings.read(current, projectId)).fields;
    const saved = await settings.save(current, projectId, {
      command: "save_settings",
      idempotencyKey: crypto.randomUUID(),
      fields: {
        preferences: {
          value: Object.assign({}, preferences.value, chosen),
          baseVersion: preferences.version,
        },
      },
    });
    if (saved.conflicts.length > 0)
      throw new ProjectError(409, "preferences_changed");
  };
  // The one way the person answers the coordinator's open question, from the answers route or an
  // approval that covers what the question asked: a screen's output saves the values it writes,
  // records what it approves, sets the preferences it names and marks the plan step it does before
  // the answer reaches the run.
  const answer = async (
    c: Context<TenantEnv>,
    projectId: string,
    signalName: string,
    given: typeof QuestionAnswer.infer,
  ) => {
    const current = actorOf(c);
    const { runId, asked } = await openQuestion(
      c,
      nativeFetch,
      projectId,
      signalName,
    );
    const screen = screenOf(
      await catalogOf(service.projectState, current, projectId),
      asked,
    );
    const answered =
      screen !== undefined && "output" in given
        ? screen.answer(given.output)
        : undefined;
    if (screen !== undefined && answered?.ok === false)
      throw new ProjectError(400, "answer_refused", {
        text: answerRefusedText(screen.name, answered.refusal),
      });
    // The conversation read above lags the framework, which can have taken an answer it still
    // shows open, so this claim, not that read, decides whether the question is still open.
    if (!(await service.claimQuestion(current, projectId, signalName)))
      throw questionClosed(signalName);
    let step = "saving values";
    try {
      if (screen !== undefined && answered?.ok) {
        const names = Object.keys(answered.values);
        const held =
          names.length === 0
            ? {}
            : readProjectValues(
                names,
                await service.projectState(current, projectId),
                CATALOG.values,
              );
        await saveValues(
          c,
          projectId,
          Object.fromEntries(
            Object.entries(answered.values).filter(
              ([name, value]) => held[name] !== value,
            ),
          ),
          CATALOG.values,
          { artifacts: service, values },
          nativeFetch,
        );
        step = "recording approvals";
        if (answered.approves.length > 0)
          await service.approveShown(
            current,
            projectId,
            answered.approves,
            screen.returns("input" in asked ? asked.input : undefined),
            (coordinator, content) =>
              mailRunAsCaller(
                c,
                nativeFetch,
                current.tenantId,
                coordinator,
                content,
              ),
          );
        step = "saving preferences";
        if (Object.keys(answered.preferences).length > 0)
          await prefer(c, projectId, answered.preferences);
        step = "marking the plan step";
        await plans.answerPlanStep(current, projectId, screen);
      }
      step = "delivering the answer";
      await answerQuestionAsCaller(
        c,
        nativeFetch,
        { tenantId: current.tenantId, runId },
        signalName,
        given,
      );
    } catch (error) {
      await service.releaseQuestion(current, projectId, signalName);
      log.error(
        "Answer failed before its run took it",
        Object.assign(
          { projectId, signalName, step },
          errorCode(error),
          requestErrorMetadata(error),
        ),
      );
      if (
        error instanceof ProjectError &&
        error.code === "reserved_signal_name"
      )
        throw questionClosed(signalName);
      throw error;
    }
  };
  return answer;
}

export type Answer = ReturnType<typeof createAnswer>;
