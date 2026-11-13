import { expect } from "bun:test";
import { eq } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import { CREDENTIAL_KEY } from "../e2e/support/hub.ts";
import { NonEmptyString } from "../e2e/support/pipeline-driver.ts";
import { DESIGNER_REPORT, WEATHER_CONCEPT, WEATHER_MOCKUP } from "./concept.ts";
import { designerFor } from "./specialists.ts";
import {
  call,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const SELECTION = "plugins.build-web-app";
const DEFAULT = "@corbits-builder/build-web-app";
const EXPRESS = "@corbits-builder/build-web-app-express";
const EXPRESS_LABEL =
  "A ready-made plan for a web app with nothing waiting on the person";

scenario({
  name: "s35-select-a-plugin",
  title:
    "the person selects the express build-web-app on the project's values, and its steps start without their go-ahead",
  start: {
    fresh:
      "I want a weather app where the whole screen animates to match the live weather.",
  },
  coordinator: [
    turn(
      user("weather app"),
      call("c_discover_default", "discover", { plugin: "build-web-app" }),
    ),
    turn(
      results(
        ok(
          "c_discover_default",
          "discover",
          `also installed: ${EXPRESS_LABEL} (${EXPRESS})`,
        ),
      ),
      say("There are two ways to build it."),
    ),
    turn(
      user("express"),
      call("c_discover_express", "discover", { plugin: "build-web-app" }),
    ),
    turn(
      results(
        ok(
          "c_discover_express",
          "discover",
          `build-web-app: using ${EXPRESS_LABEL} (${EXPRESS})`,
        ),
      ),
      call("c_follow", "plan", { operation: "add", plan: "build-web-app" }),
    ),
    // The default build-web-app holds the mockup for the person's approval of the requirements,
    // which are not even written; the express one asks for no go-ahead, so it starts.
    turn(
      results(ok("c_follow", "plan", "write-requirements")),
      execute("c_mockup", "designer", "mockup", WEATHER_MOCKUP),
    ),
    turn(
      results(ok("c_mockup", "execute", '"started":true')),
      say("A designer is on it."),
    ),
    turn(user(DESIGNER_REPORT), say("The design is filed.")),
  ],
  specialists: {
    designer: { role: "designer", turns: designerFor(WEATHER_CONCEPT.label) },
  },
  values: [SELECTION],
  person: async (p) => {
    await p.heard("There are two ways to build it.");
    const before = p.resultOf("c_discover_default").text;
    p.note("discover before the selection", before);
    expect(before).toContain(
      `build-web-app: using A ready-made plan for a web app: requirements`,
    );

    const saved = await p.call("POST", `${p.path}/values`, {
      values: { [SELECTION]: EXPRESS },
    });
    expect(saved.status).toBe(200);
    const wrong = await p.call("POST", `${p.path}/values`, {
      values: { [SELECTION]: "@corbits-builder/not-installed" },
    });
    expect(wrong.status).toBe(400);

    await p.say("Use the express one, I don't want to approve every step.");
    await p.heard("The design is filed.");
    p.note(
      "discover after the selection",
      p.resultOf("c_discover_express").text,
    );
    p.note("following the plan returned", p.resultOf("c_follow").text);
    p.note("the mockup returned", p.resultOf("c_mockup").text);

    // The coordinator's own run token, as its tools would send it, cannot switch back.
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
    const write = await p.call(
      "POST",
      `${p.path}/values`,
      { values: { [SELECTION]: DEFAULT } },
      {
        authorization: `Bearer ${delivery.token}`,
        "content-type": "application/json",
      },
    );
    p.note("the coordinator's run token switching back", write);
    expect(write.status).toBe(403);
    const after = await p.call("GET", `${p.path}/values?keys=${SELECTION}`);
    expect(after.body).toEqual({ values: { [SELECTION]: EXPRESS } });
  },
});
