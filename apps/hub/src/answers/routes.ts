import { type } from "arktype";
import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { TenantEnv } from "@intx/hub-api";
import { QuestionAnswer } from "@intx/types/signals";
import { ProjectError } from "../projects/errors.ts";
import { body } from "../http/route-parts.ts";
import type { Answer } from "./answer.ts";

const AnswerPost = type({
  "+": "reject",
  signalName: "string > 0",
  answer: QuestionAnswer,
});

export function mountAnswerRoutes(app: Hono<TenantEnv>, answer: Answer) {
  app.post(
    "/:projectId/answers",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "answerQuestion",
      description:
        "The signed-in person answers the question the project's coordinator is waiting on, by its signal name: a question card's answers, a screen's output, or a reply they typed instead. For a screen's output the hub checks it against the screen's output schema and saves the project values the screen writes from it where they changed. It records what it approves: a document's approval at the version shown, or the design option chosen as the design, each only among the facts the question allows. It also sets the project preferences the screen sets from it, such as leaving approvals to Builder. Then it delivers the answer to the run through Interchange's signal route as the person. A reply is delivered as it is.",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(AnswerPost) } },
      },
      responses: {
        200: { description: "The answer was recorded and delivered" },
        400: {
          description:
            "The output does not fit the screen; text says, for the person, each part that is wrong and that the question is still open",
        },
        403: { description: "The caller is not a person on the project" },
        404: { description: "No open question by that signal name" },
        409: {
          description:
            "The question was answered already, or the answer approves what was not asked or a version that is no longer the newest",
        },
      },
    }),
    async (c) => {
      const input = AnswerPost(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_answer", { issues: input });
      await answer(c, c.req.param("projectId"), input.signalName, input.answer);
      return c.json({ signalName: input.signalName });
    },
  );
}
