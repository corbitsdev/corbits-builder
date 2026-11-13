import { expect } from "bun:test";
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

const SENTENCE = "Honestly I just want it to feel friendlier, not a new font.";
const FONTS = ["look.font-primary", "look.font-secondary"];
const WAIT_MS = 180_000;
const themeImport = '@import "@corbits/react-ui/theme.css";\n';
const instruction =
  "Set the app's headings and body text in Arial and its code and figures in Bitter, the fonts the person picked. Change nothing else.";
const report =
  "Headings and body text are now Arial, and code and figures are Bitter; check-app passed.";
const pickFonts = (id: string) =>
  execute(id, "designer", "pick-fonts", { proposed: { primary: "Arial" } });

scenario({
  name: "s07-typed-reply-browser",
  title:
    "in the web app the person types a sentence while the font picker is open, which changes no font; then picks and saves fonts, and a coder applies them to the built app",
  start: "weather-app",
  values: FONTS,
  coordinator: [
    turn(user("the font is ugly"), pickFonts("c_fonts")),
    turn(
      results(ok("c_fonts", "execute", SENTENCE)),
      say("Friendlier it is; tell me what feels unfriendly now."),
    ),
    turn(user("change the fonts after all"), pickFonts("c_fonts_2")),
    turn(
      results(ok("c_fonts_2", "execute", "Bitter")),
      execute("c_change", "coder", "change", { instruction }),
    ),
    turn(
      results(ok("c_change", "execute")),
      say("The coder is switching the fonts to Arial and Bitter."),
    ),
    // The fonts are look values, saved onto the filed design, and the hub notes that save too.
    turn(user("Look saved to the design"), say("The design has your fonts.")),
    turn(user(report), say("Your app now uses Arial and Bitter.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: [
        turn(
          user("code and figures in Bitter"),
          call("coder_fonts", "edit_file", {
            path: "client/src/styles.css",
            old_string: themeImport,
            new_string:
              themeImport +
              '\nbody {\n  font-family: "Arial", sans-serif;\n}\n\ncode,\npre,\nfigure {\n  font-family: "Bitter", serif;\n}\n',
          }),
          CODER_TOOLS,
        ),
        turn(
          results(ok("coder_fonts", "edit_file")),
          call("coder_check", "run_shell", {
            command: "check-stack",
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
    const fonts = () =>
      p.call("GET", `${p.path}/values?keys=${FONTS.join(",")}`);
    await p.heard("The project is imported.");
    const before = await fonts();
    await p.say("the font is ugly");
    await p.question();
    await p.browser(async (page, shoot) => {
      await page.getByText("Choose your fonts").waitFor({ timeout: WAIT_MS });
      await shoot("01-font-picker-open");
      const composer = page.locator('[data-slot="composer"] textarea').first();
      await composer.fill(SENTENCE);
      await composer.press("Enter");
      await page
        .getByText("Friendlier it is")
        .first()
        .waitFor({ timeout: WAIT_MS });
      await shoot("02-sentence-answered");
      // A typed reply answers the picker with the sentence and saves no font.
      expect(JSON.parse(p.resultOf("c_fonts").text)).toEqual({
        reply: SENTENCE,
      });
      expect((await fonts()).body).toEqual(before.body);

      await p.say("Fine, change the fonts after all.");
      const proposed = page.getByRole("button", {
        name: "Use Arial as primary",
      });
      await proposed.waitFor({ timeout: WAIT_MS });
      await proposed.click();
      await page.getByRole("button", { name: /^Secondary/ }).click();
      await page.getByRole("combobox").fill("Bitter");
      await page.getByRole("option", { name: "Bitter", exact: true }).click();
      await shoot("03-fonts-chosen");
      await page.getByRole("button", { name: "Change my fonts" }).click();
      await page
        .getByText("Your app now uses Arial and Bitter.")
        .first()
        .waitFor({ timeout: WAIT_MS });
      await shoot("04-coder-applied-fonts");
    });
    const saved = await fonts();
    expect(saved.body).toMatchObject({
      values: { "look.font-primary": "Arial", "look.font-secondary": "Bitter" },
    });
    expect(p.assignment("coder")).toContain(instruction);
  },
});
