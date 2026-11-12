import { expect } from "bun:test";
import { eq } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import { CREDENTIAL_KEY } from "../e2e/support/hub.ts";
import { NonEmptyString } from "../e2e/support/pipeline-driver.ts";
import { CODER_TOOLS } from "./specialists.ts";
import {
  call,
  calls,
  execute,
  ok,
  refused,
  results,
  say,
  scenario,
  startedRun,
  turn,
  user,
} from "./runner.ts";

const language = "TypeScript with React";
const report = `The app is written in ${language}; I saved that.`;
const tools = [...CODER_TOOLS, "report_values"];

scenario({
  name: "s20-agent-saves-values",
  title:
    "a coder saves the language it found, is refused a value its action does not write and one of the wrong type, and its run token cannot write values directly",
  start: "weather-app",
  expectFailure:
    "discover lists only whether each project value is set, never its value, so the coordinator cannot see the language the coder saved; and on any request a person would make, even one only the coder answers, discover lists several plugins and runs past the 10,000 characters a tool result keeps, cutting the values list off entirely; only discover of one group shows the list",
  values: ["stack.language", "brand.guidelines"],
  coordinator: [
    turn(
      user("language"),
      execute("c_change", "coder", "change", {
        instruction:
          "Find out which language the app is written in and save it, then tidy the settings page labels.",
      }),
    ),
    turn(results(ok("c_change", "execute")), say("A coder is on it.")),
    turn(
      user(report),
      calls(
        call("c_discover_group", "discover", { group: "change" }),
        call("c_discover_narrow", "discover", {
          query: "the save button does nothing",
        }),
        call("c_discover", "discover", {
          query: "change the app's code, what language is it written in",
        }),
      ),
    ),
    turn(
      results(
        ok("c_discover_group", "discover", "stack.language"),
        ok("c_discover_narrow", "discover"),
        ok("c_discover", "discover"),
      ),
      say("The coder reported the app's language."),
    ),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: [
        turn(
          user("which language"),
          call("v_language", "report_values", {
            "stack.language": language,
          }),
          tools,
        ),
        turn(
          results(ok("v_language", "report_values", language)),
          call("v_undeclared", "report_values", {
            "brand.guidelines": "Shout everything.",
          }),
          tools,
        ),
        turn(
          results(refused("v_undeclared", "report_values")),
          call("v_wrong_type", "report_values", { "stack.language": 42 }),
          tools,
        ),
        // Holds the run open while the person tries its token.
        turn(
          results(refused("v_wrong_type", "report_values")),
          call("coder_work", "run_shell", {
            command: "sleep 20",
            timeout: 80_000,
          }),
          tools,
        ),
        turn(results(ok("coder_work", "run_shell")), say(report), tools),
      ],
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Which language is the app in? Tidy the settings labels too.");
    await p.until("the coder to hold its run open", async () =>
      p.asked("coder") >= 4 ? true : undefined,
    );
    const runId = startedRun(p.resultOf("c_change").text);
    const [run] = await p.hub.db
      .select({ principalId: workflowRun.principalId })
      .from(workflowRun)
      .where(eq(workflowRun.id, runId));
    const tokens = createRunTokenStore({
      db: p.hub.db,
      cipher: createEnvKeyCredentialCipher(hexDecode(CREDENTIAL_KEY)),
    });
    const deliveries = await tokens.loadDelivery(
      NonEmptyString.assert(run?.principalId),
    );
    p.note(
      "the coder run's token consumers",
      deliveries.map(({ consumer }) => consumer),
    );
    // The token report_values itself sends.
    const delivery = deliveries.find(({ consumer }) =>
      consumer.includes("@corbits-builder/artifacts/tools"),
    );
    if (delivery === undefined)
      throw new Error("The coder run holds no token for its artifact tools");
    const bearer = {
      authorization: `Bearer ${delivery.token}`,
      "content-type": "application/json",
    };
    // The same token on the route report_values uses, to show the token itself is good.
    const own = await p.call(
      "POST",
      `${p.path}/run-values`,
      { values: { "stack.language": language } },
      bearer,
    );
    const read = await p.call(
      "GET",
      `${p.path}/values?keys=stack.language`,
      undefined,
      bearer,
    );
    const direct = await p.call(
      "POST",
      `${p.path}/values`,
      { values: { "stack.language": "Rust" } },
      bearer,
    );
    await p.heard("The coder reported the app's language.");
    p.note("report_values of a declared value", p.resultOf("v_language"));
    p.note("report_values of an undeclared value", p.resultOf("v_undeclared"));
    p.note("report_values of the wrong type", p.resultOf("v_wrong_type"));
    p.note(
      "discover of the change group after the coder saved",
      p.resultOf("c_discover_group").text,
    );
    p.note(
      "discover for a narrow request after the coder saved",
      p.resultOf("c_discover_narrow").text,
    );
    p.note(
      "discover for a broad request after the coder saved",
      p.resultOf("c_discover").text,
    );
    expect(own.status).toBe(200);
    expect(read.status).toBeGreaterThanOrEqual(400);
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect(p.resultOf("v_undeclared").text).toContain("brand.guidelines");
    const stored = await p.call("GET", `${p.path}/values?keys=stack.language`);
    expect(stored.body).toEqual({ values: { "stack.language": language } });
    expect(p.resultOf("c_discover_group").text).toContain(language);
  },
});
