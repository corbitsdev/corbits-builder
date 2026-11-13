import { expect } from "bun:test";
import { eq } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import { CREDENTIAL_KEY } from "../e2e/support/hub.ts";
import { NonEmptyString } from "../e2e/support/pipeline-driver.ts";
import { writerFiles } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

const first = "The competitor analysis is filed.";
const revised = "The competitor analysis now has prices.";
const note =
  "Hub note, not from the person: The person approved the competitor analysis, version 1.";

scenario({
  name: "s29-approve-without-being-asked",
  title:
    "the person approves a document from the document itself: the coordinator hears it with no question open, an open approve question for it is answered as the screen would, and an older version is refused",
  start: { fresh: "Write me a competitor analysis of the dog-walking apps." },
  coordinator: [
    turn(
      user("competitor analysis"),
      execute("c_write", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: "Compare the dog-walking apps people near us use.",
      }),
    ),
    turn(results(ok("c_write", "execute")), say("A writer is on it.")),
    turn(user(first), say("The competitor analysis is ready to read.")),
    // No question is open, so the approval reaches the coordinator as a hub note.
    turn(user(note), say("Noted: the competitor analysis is approved.")),
    turn(
      user("price of a walk"),
      execute("c_revise", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: "Add the price of a walk to every app compared.",
      }),
    ),
    turn(results(ok("c_revise", "execute")), say("A writer is adding prices.")),
    turn(
      user(revised),
      execute("c_approve", "writer", "approve", {
        kinds: ["competitor_analysis"],
      }),
    ),
    // The approval from the document answers the open question, so it comes back as its result.
    turn(
      results(ok("c_approve", "execute", '"approved"')),
      say("The revision is approved."),
    ),
  ],
  specialists: {
    "writer-1": {
      role: "writer",
      turns: writerFiles({
        assignedWith: "Compare the dog-walking apps",
        kind: "competitor_analysis",
        content: "## In short\nThree apps serve our area.",
        report: first,
      }),
    },
    "writer-2": {
      role: "writer",
      turns: writerFiles({
        assignedWith: "Add the price of a walk",
        kind: "competitor_analysis",
        content:
          "## In short\nThree apps serve our area, from 15 to 25 a walk.",
        report: revised,
      }),
    },
  },
  person: async (p) => {
    const shown = await p.filed("competitor_analysis", 1);
    await p.heard("The competitor analysis is ready to read.");
    const approval = `${p.path}/artifacts/${shown.artifactId}/approval`;

    // The coordinator's own run token, as its tools would send it, cannot approve for the person.
    const [run] = await p.hub.db
      .select({ principalId: workflowRun.principalId })
      .from(workflowRun)
      .where(eq(workflowRun.id, p.coordinatorRunId));
    const tokens = createRunTokenStore({
      db: p.hub.db,
      cipher: createEnvKeyCredentialCipher(hexDecode(CREDENTIAL_KEY)),
    });
    const [delivery] = await tokens.loadDelivery(
      NonEmptyString.assert(run?.principalId),
    );
    if (delivery === undefined)
      throw new Error("The coordinator run holds no run token");
    const byAgent = await p.call(
      "POST",
      approval,
      { version: 1 },
      {
        authorization: `Bearer ${delivery.token}`,
        "content-type": "application/json",
      },
    );
    expect(byAgent.status).toBeGreaterThanOrEqual(400);
    expect((await p.filed("competitor_analysis", 1)).approvedVersion).toBe(
      undefined,
    );

    // With no question open: recorded, the fact holds, and the coordinator hears the note.
    const unasked = await p.call("POST", approval, { version: 1 });
    p.note("approved with no question open", unasked);
    expect(unasked.status).toBe(200);
    expect(unasked.body).toEqual({
      artifactId: shown.artifactId,
      kind: "competitor_analysis",
      version: 1,
    });
    // approved:competitor_analysis holds when the approved version is the current one.
    const approved = await p.filed("competitor_analysis", 1);
    expect(approved.approvedVersion).toBe(approved.version);
    await p.heard("Noted: the competitor analysis is approved.");
    expect(
      p.messages("coordinator").some((message) => message.includes(note)),
    ).toBe(true);

    // With an approve question open for the same document.
    await p.say("Add the price of a walk to every app.");
    await p.filed("competitor_analysis", 2);
    const open = await p.question();

    const stale = await p.call("POST", approval, { version: 1 });
    p.note("approving the older version", stale);
    expect(stale.status).toBe(409);
    expect(JSON.stringify(stale.body)).toContain("artifact_ref_stale");

    const settled = await p.call("POST", approval, { version: 2 });
    p.note("approved with the question open", settled);
    expect(settled.status).toBe(200);
    expect(settled.body).toEqual({
      artifactId: shown.artifactId,
      kind: "competitor_analysis",
      version: 2,
      answered: open.signalName,
    });
    await p.heard("The revision is approved.");
    // What the approve screen returns: each document it asked for at the version on show.
    const result = p.resultOf("c_approve");
    p.note("the question's result", result);
    expect(result.isError).toBe(false);
    expect(result.text).toContain(shown.artifactId);
    expect(result.text).toContain('"kind":"competitor_analysis"');
    expect(result.text).toContain('"version":2');
    expect((await p.filed("competitor_analysis", 2)).approvedVersion).toBe(2);
    // The question's answer told the coordinator, so no note was sent for version 2.
    expect(
      p
        .messages("coordinator")
        .some((message) =>
          message.includes("approved the competitor analysis, version 2"),
        ),
    ).toBe(false);
  },
});
