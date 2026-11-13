import { expect } from "bun:test";
import { CheckList } from "@corbits-builder/schemas/artifact";
import { CODER_TOOLS } from "./specialists.ts";
import {
  call,
  CHECK_APP_MS,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const styles = "client/src/styles.css";
const themeImport = '@import "@corbits/react-ui/theme.css";\n';
const font = '\nbody {\n  font-family: "Inter", sans-serif;\n}\n';
// After its check passed, the coder imports a stylesheet the app does not have, from a script the
// director does not read as a file change, so the saved app no longer builds.
const missing = '@import "./inter.css";\n';
const prepend = `bun -e 'const path = "${styles}"; await Bun.write(path, ${JSON.stringify(missing)} + (await Bun.file(path).text()))'`;
const firstReply = "All text is now set in Inter.";
const report = "All text is now set in Inter, and the app builds.";
const checkStack = (id: string) =>
  call(id, "run_shell", { command: "check-stack", timeout: CHECK_APP_MS });

scenario({
  name: "s36-done-when",
  title:
    "a directed change goes to a coder with no approval asked and no document touched, and is done only when builds passes on the saved app: the director holds the reply with the hub's evidence in the same conversation, the coder fixes it, and only then does the coordinator get the report",
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
      turns: [
        turn(
          user("Inter"),
          call("coder_font", "edit_file", {
            path: styles,
            old_string: themeImport,
            new_string: themeImport + font,
          }),
          CODER_TOOLS,
        ),
        turn(
          results(ok("coder_font", "edit_file")),
          checkStack("coder_check"),
          CODER_TOOLS,
        ),
        turn(
          results(
            ok("coder_check", "run_shell", "The app is filed as version"),
          ),
          call("coder_break", "run_shell", { command: prepend }),
          CODER_TOOLS,
        ),
        turn(
          results(ok("coder_break", "run_shell")),
          say(firstReply),
          CODER_TOOLS,
        ),
        // The held reply's note names the failed check and its evidence, in the same conversation.
        turn(
          user("coder builds failed"),
          call("coder_fix", "edit_file", {
            path: styles,
            old_string: missing,
            new_string: "",
          }),
          CODER_TOOLS,
        ),
        turn(
          results(ok("coder_fix", "edit_file")),
          checkStack("coder_recheck"),
          CODER_TOOLS,
        ),
        turn(
          results(
            ok("coder_recheck", "run_shell", "The app is filed as version"),
          ),
          say(report),
          CODER_TOOLS,
        ),
      ],
    },
  },
  person: async (p) => {
    const { client } = p.hub;
    const documents = async () =>
      (await client.projectArtifacts(p.tenantId, p.projectId)).artifacts
        .filter((artifact) => artifact.kind !== "app")
        .map(({ kind, version, approvedVersion }) => ({
          kind,
          version,
          approvedVersion,
        }));
    await p.heard("The project is imported.");
    const before = await documents();
    const decidedBefore = await client.decidedApprovals(
      p.tenantId,
      p.projectId,
    );
    await p.say("change the font to Inter");
    await p.heard("Your app now uses Inter.");
    const { data: approvals } = await client.nativeApprovals(p.tenantId);
    expect(approvals.filter(({ status }) => status === "pending")).toEqual([]);
    expect(await documents()).toEqual(before);
    expect(await client.decidedApprovals(p.tenantId, p.projectId)).toEqual(
      decidedBefore,
    );

    // The held reply names the failed check and its evidence, so the coder can fix it.
    const held = p.messages("coder")[1];
    p.note("what the coder was told when its reply was held", held);
    expect(held).toContain("coder builds failed");
    expect(held).toContain("inter.css");

    const reports = p
      .messages("coordinator")
      .filter((message) => message.includes("Inter"));
    p.note("the coder's reports the coordinator received", reports);
    expect(reports.some((message) => message.includes(report))).toBe(true);
    expect(reports.some((message) => message.includes(firstReply))).toBe(false);

    const listed = await p.call("GET", `${p.path}/checks`);
    const builds = CheckList.assert(listed.body).checks.find(
      (check) => check.plugin === "coder" && check.action === "builds",
    );
    p.note("coder builds' latest record", builds);
    expect(builds).toMatchObject({ result: "pass", current: true });
    expect(builds?.triggeredBy.startsWith("run:")).toBe(true);
  },
});
