import { expect } from "bun:test";
import { CODER_TOOLS } from "./specialists.ts";
import {
  call,
  calls,
  CHECK_APP_MS,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
  type Person,
} from "./runner.ts";

const instruction =
  "Add date formatting and duration parsing libraries to the client.";
const report =
  "Both libraries are installed in the client and check-stack passed.";
const TOOLS = [...CODER_TOOLS, "install_packages"];
const INSTALLS = { i_dayjs: "dayjs@1.11.13", i_ms: "ms@2.1.3" };

// The person approves the one install waiting on them; two waiting at once is the regression.
async function approveInstall(p: Person, approved: readonly string[]) {
  const approval = await p.until("an install to approve", async () => {
    const { data } = await p.hub.client.nativeApprovals(p.tenantId);
    const pending = data.filter(
      ({ status, id }) => status === "pending" && !approved.includes(id),
    );
    if (pending.length > 1)
      throw new Error(`${String(pending.length)} installs wait at once`);
    return pending[0];
  });
  p.note("an install waits for the person", approval.toolArguments);
  await p.hub.client.decideNativeApproval(p.tenantId, approval.id, "approve");
  return approval;
}

scenario({
  name: "s40-two-installs-in-one-step",
  title:
    "a coder asks for two installs in one turn: each is put to the person in turn, both get results, and the run goes on to check-stack and its report",
  start: "weather-app",
  coordinator: [
    turn(
      user("duration parser"),
      execute("c_change", "coder", "change", { instruction }),
    ),
    turn(results(ok("c_change", "execute")), say("A coder is on it.")),
    turn(user(report), say("Both libraries are in.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: [
        turn(
          user(instruction),
          calls(
            ...Object.entries(INSTALLS).map(([id, spec]) =>
              call(id, "install_packages", {
                workspace: "client",
                packages: [spec],
              }),
            ),
          ),
          TOOLS,
        ),
        turn(
          results(
            ...Object.keys(INSTALLS).map((id) => ok(id, "install_packages")),
          ),
          call("coder_check", "run_shell", {
            command: "check-stack",
            timeout: CHECK_APP_MS,
          }),
          TOOLS,
        ),
        turn(
          results(ok("coder_check", "run_shell", "check passed")),
          say(report),
          TOOLS,
        ),
      ],
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say(
      "Add a date formatting library and a duration parser to the client.",
    );
    const first = await approveInstall(p, []);
    const second = await approveInstall(p, [first.id]);
    expect(
      [first, second].map(({ toolArguments }) => toolArguments["packages"]),
    ).toEqual(Object.values(INSTALLS).map((spec) => [spec]));
    await p.heard("Both libraries are in.");
    for (const id of Object.keys(INSTALLS))
      p.note(`${id} returned`, p.resultOf(id).text);
    expect(p.asked("coder")).toBe(3);
  },
});
