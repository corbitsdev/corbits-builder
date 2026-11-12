import { expect } from "bun:test";
import { eq } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import { CREDENTIAL_KEY } from "../e2e/support/hub.ts";
import { NonEmptyString } from "../e2e/support/pipeline-driver.ts";
import { coderChange } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

const guidelines =
  "Warm and plain. Never use exclamation marks. Prefer Inter for all text.";
const report = "All text is now set in Inter; check-app passed.";

scenario({
  name: "s04-values-to-an-agent",
  title:
    "a value the person saves reaches the coder's assignment, and a run token cannot save one",
  start: "weather-app",
  coordinator: [
    turn(
      user("change the font to Inter"),
      execute("c_change", "coder", "change", {
        instruction:
          "Change the app's font to Inter for all text: set the body font-family to Inter in client/src/styles.css.",
      }),
    ),
    turn(results(ok("c_change", "execute")), say("A coder is on it.")),
    turn(user(report), say("Your app now uses Inter.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: coderChange({ assignedWith: guidelines, report }),
    },
  },
  values: ["brand.guidelines", "stack.language"],
  person: async (p) => {
    await p.heard("The project is imported.");
    const saved = await p.call("POST", `${p.path}/values`, {
      values: { "brand.guidelines": guidelines },
    });
    expect(saved.status).toBe(200);
    await p.say("change the font to Inter");
    await p.heard("Your app now uses Inter.");
    const assignment = p.assignment("coder");
    p.note("the coder's assignment", assignment);
    expect(assignment).toContain(guidelines);

    // The coordinator's own run token, as its tools would send it.
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
    const bearer = {
      authorization: `Bearer ${delivery.token}`,
      "content-type": "application/json",
    };
    const read = await p.call(
      "GET",
      `${p.path}/values?keys=brand.guidelines`,
      undefined,
      bearer,
    );
    expect(read.status).toBe(200);
    const write = await p.call(
      "POST",
      `${p.path}/values`,
      { values: { "brand.guidelines": "Shout!" } },
      bearer,
    );
    expect(write.status).toBeGreaterThanOrEqual(400);
    const after = await p.call("GET", `${p.path}/values?keys=brand.guidelines`);
    expect(after.body).toEqual({ values: { "brand.guidelines": guidelines } });
  },
});
