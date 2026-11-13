import { expect } from "bun:test";
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
import { CODER_TOOLS } from "./specialists.ts";

const FONTS = ["look.font-primary", "look.font-secondary"];
const themeImport = '@import "@corbits/react-ui/theme.css";\n';
const instruction =
  "Set the app's body text in Arial and its headings in Bitter, the fonts the person picked. Change nothing else.";
const report =
  "Body text is now Arial and headings are Bitter; check-app passed.";

scenario({
  name: "s37-font-change-browser",
  title:
    "in the web app the person picks and saves fonts, and a coder applies them to the built app",
  start: "weather-app",
  values: FONTS,
  coordinator: [
    turn(
      user("the font is ugly"),
      execute("c_fonts", "designer", "pick-fonts", {
        proposed: { primary: "Arial" },
      }),
    ),
    turn(
      results(ok("c_fonts", "execute", "Bitter")),
      execute("c_change", "coder", "change", { instruction }),
    ),
    turn(
      results(ok("c_change", "execute")),
      say("The coder is switching the fonts to Arial and Bitter."),
    ),
    turn(user(report), say("Your app now uses Arial and Bitter.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: [
        turn(
          user("Arial and its headings in Bitter"),
          call("coder_fonts", "edit_file", {
            path: "client/src/styles.css",
            old_string: themeImport,
            new_string:
              themeImport +
              '\nbody {\n  font-family: "Arial", sans-serif;\n}\n\nh1,\nh2,\nh3 {\n  font-family: "Bitter", serif;\n}\n',
          }),
          CODER_TOOLS,
        ),
        turn(
          results(ok("coder_fonts", "edit_file")),
          call("coder_check", "run_shell", {
            command: "check-app",
            timeout: CHECK_APP_MS,
          }),
          CODER_TOOLS,
        ),
        turn(
          results(
            ok("coder_check", "run_shell", "The app is filed as version"),
          ),
          say(report),
          CODER_TOOLS,
        ),
      ],
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("the font is ugly");
    await p.question();
    await p.browser(async (page, shoot) => {
      await page.getByText("Choose your fonts").waitFor({ timeout: 180_000 });
      await page.getByText("Proposed: Arial").waitFor();
      await shoot("01-font-picker-proposal");
      await page.getByRole("button", { name: "Choose something else" }).click();
      await page.getByRole("combobox").fill("Arial");
      await page.getByRole("option", { name: "Arial", exact: true }).click();
      await page.getByRole("button", { name: /^Secondary/ }).click();
      await page.getByRole("combobox").fill("Bitter");
      await page.getByRole("option", { name: "Bitter", exact: true }).click();
      await shoot("02-fonts-chosen");
      await page.getByRole("button", { name: "Save fonts" }).click();
      await page
        .getByText("Primary: Arial. Secondary: Bitter.")
        .waitFor({ timeout: 180_000 });
      await shoot("03-font-picker-settled");
      await page
        .getByText("Your app now uses Arial and Bitter.")
        .first()
        .waitFor({ timeout: 180_000 });
      await shoot("04-coder-report-reached-coordinator");
    });
    p.note("the coordinator received", p.resultOf("c_fonts").text);
    const saved = await p.call(
      "GET",
      `${p.path}/values?keys=${FONTS.join(",")}`,
    );
    expect(saved.body).toMatchObject({
      values: { "look.font-primary": "Arial", "look.font-secondary": "Bitter" },
    });
    expect(p.assignment("coder")).toContain(instruction);
  },
});
