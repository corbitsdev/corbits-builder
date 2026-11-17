import { expect, test } from "bun:test";
import { type } from "arktype";
import {
  call,
  execute,
  ok,
  openProject,
  results,
  say,
  turn,
  user,
} from "../support/scripted-project.ts";

const INSTRUCTION =
  "Set the app's headings and body text in Arial and its code and figures in Bitter, the fonts the person picked. Change nothing else.";
const ARIAL_AND_BITTER = {
  primary: { name: "Arial", lists: ["sans"], license: "free" },
  secondary: { name: "Bitter", lists: ["serif"], license: "free" },
};
const StartedRuns = type({ runs: type({ runId: "string" }).array() });

// On Linux a stopped run asks the model again before its stop lands, which the scripted
// model cannot answer; tracked upstream.
test.skipIf(process.platform === "linux")(
  "the hub lets a font change on a built app run through the font picker and start only a coder change, adding no plan step, gate or document work (which actions the coordinator picks is scripted here, not proven)",
  async () => {
    const project = await openProject({
      start: { seed: "habit-tracker" },
      runs: {
        coordinator: {
          role: "coordinator",
          turns: [
            turn(
              user("the font is ugly"),
              execute("c_fonts", "designer", "pick-fonts", {
                proposed: { primary: "Arial" },
              }),
            ),
            turn(
              results(ok("c_fonts", "execute", "Bitter")),
              execute("c_change", "coder", "change", {
                instruction: INSTRUCTION,
              }),
            ),
            turn(
              results(ok("c_change", "execute")),
              say("A coder is switching the fonts to Arial and Bitter."),
            ),
            turn(
              user("Look saved to the design"),
              say("The design has your fonts."),
            ),
            // The notice that the coder this test stops has ended.
            turn(user(), say("The coder has stopped.")),
          ],
        },
        coder: {
          role: "coder",
          turns: [
            turn(
              user("code and figures in Bitter"),
              call("coder_wait", "run_shell", {
                command: "sleep 120",
                timeout: 180_000,
              }),
            ),
          ],
        },
      },
    });
    try {
      const before = await project.artifacts();
      await project.say("the font is ugly");
      const picker = await project.question();
      expect(
        (await project.answer(picker.signalName, { output: ARIAL_AND_BITTER }))
          .status,
      ).toBe(200);
      await project.heard("A coder is switching the fonts");
      const change = project.resultOf("c_change");
      expect(change.isError).toBe(false);
      expect(change.text).not.toContain('"advice"');

      await project.until("the coder at work", async () =>
        project.asked("coder") === 1 ? true : undefined,
      );
      expect(project.messages("coder")[0]).toContain(INSTRUCTION);
      const [coder] = StartedRuns.assert(JSON.parse(change.text)).runs;
      await project.hub.client.stopRun(
        project.tenantId,
        project.projectId,
        coder!.runId,
      );
      await project.heard("The coder has stopped.");

      expect(await project.actionsRun()).toEqual(["coder change"]);
      const versions = (artifacts: typeof before) =>
        Object.fromEntries(
          artifacts.map(({ kind, version }) => [kind, version]),
        );
      const design = before.find(({ kind }) => kind === "design");
      expect(versions(await project.artifacts())).toEqual(
        Object.assign(versions(before), { design: design!.version + 1 }),
      );
      await project.finish();
    } finally {
      await project.close();
    }
  },
  600_000,
);
