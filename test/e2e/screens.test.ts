import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { grant, principal, user as person } from "@intx/db/schema";
import { signUpSessionCookie } from "./support/hub.ts";
import {
  execute,
  ok,
  openProject,
  refused,
  results,
  say,
  turn,
  user,
  type ScriptedProject,
} from "./support/scripted-project.ts";

const FONTS = ["look.font-primary", "look.font-secondary"];
const IDEA = "A recipe box where I keep the dishes my family cooks most.";
const SENTENCE = "Honestly I want it friendlier, not a new font.";
const font = (name: string, list: string) => ({
  name,
  lists: [list],
  license: "free",
});
const ARIAL_AND_BITTER = {
  primary: font("Arial", "sans"),
  secondary: font("Bitter", "serif"),
};
const pickFonts = (id: string, primary: string) =>
  execute(id, "designer", "pick-fonts", { proposed: { primary } });

// A second person who may read the project but not manage it, and the headers they call it with.
async function reader(project: ScriptedProject) {
  const { hub, tenantId, projectId } = project;
  const email = `reader-${randomUUID()}@example.invalid`;
  const cookie = await signUpSessionCookie(
    fetch,
    hub.baseUrl,
    email,
    "reader-password-123456",
    "Reader",
  );
  const [signedUp] = await hub.db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.email, email));
  const principalId = randomUUID();
  await hub.db.insert(principal).values({
    id: principalId,
    tenantId,
    kind: "user",
    refId: signedUp!.id,
    status: "active",
  });
  await hub.db.insert(grant).values({
    id: randomUUID(),
    tenantId,
    principalId,
    resource: `sb-project:${projectId}`,
    action: "read",
    effect: "allow",
    origin: "system",
  });
  return { cookie, origin: hub.baseUrl, "content-type": "application/json" };
}

test("the font picker opens from execute with the stored fonts behind it, refuses what does not fit or who may not answer, closes on a typed reply, and saves one answer as the call's result", async () => {
  const project = await openProject({
    start: { idea: IDEA, title: "Recipe Box" },
    runs: {
      coordinator: {
        role: "coordinator",
        turns: [
          turn(user("recipe box"), say("Tell me what to change.")),
          turn(user("the font is ugly"), pickFonts("c_same", "Fraunces")),
          turn(
            results(refused("c_same", "execute", "already the font in use")),
            pickFonts("c_fonts", "Arial"),
          ),
          turn(
            results(ok("c_fonts", "execute", SENTENCE)),
            pickFonts("c_fonts_again", "Arial"),
          ),
          turn(
            results(ok("c_fonts_again", "execute", "Bitter")),
            say("Arial and Bitter it is."),
          ),
        ],
      },
    },
  });
  try {
    await project.heard("Tell me what to change.");
    const stored = await project.call("POST", `${project.path}/values`, {
      values: {
        "look.font-primary": "Fraunces",
        "look.font-secondary": "IBM Plex Mono",
      },
    });
    expect(stored.status).toBe(200);
    const before = await project.values(FONTS);
    await project.say("the font is ugly");

    // Proposing the font the project already uses was refused before anything opened, so the
    // screen was checked against the stored values; a different font opens it.
    const open = await project.question();
    expect(open.asked).toEqual({
      plugin: "designer",
      action: "pick-fonts",
      input: { proposed: { primary: "Arial" } },
    });

    const notManaging = await project.answer(
      open.signalName,
      { output: ARIAL_AND_BITTER },
      await reader(project),
    );
    expect(notManaging.status).toBe(403);

    const unfit = await project.answer(open.signalName, {
      output: { primary: font("Arial", "sans") },
    });
    expect(unfit.status).toBe(400);
    expect(unfit.body).toMatchObject({ code: "answer_refused" });
    expect(JSON.stringify(unfit.body)).toContain("secondary");
    expect((await project.question()).signalName).toBe(open.signalName);
    expect(await project.values(FONTS)).toEqual(before);

    const typed = await project.answer(open.signalName, { reply: SENTENCE });
    expect(typed.status).toBe(200);
    const reopened = await project.until("the picker opened again", async () =>
      (await project.questions()).find(
        (asked) =>
          asked.status === "open" && asked.signalName !== open.signalName,
      ),
    );
    expect(JSON.parse(project.resultOf("c_fonts").text)).toEqual({
      reply: SENTENCE,
    });
    expect(await project.values(FONTS)).toEqual(before);

    const chosen = await project.answer(reopened.signalName, {
      output: ARIAL_AND_BITTER,
    });
    expect(chosen.status).toBe(200);
    const changedMind = await project.answer(reopened.signalName, {
      output: {
        primary: font("Inter", "sans"),
        secondary: font("JetBrains Mono", "mono"),
      },
    });
    expect(changedMind.status).toBe(409);

    await project.heard("Arial and Bitter it is.");
    expect(JSON.parse(project.resultOf("c_fonts_again").text)).toEqual({
      output: ARIAL_AND_BITTER,
    });
    expect(await project.values(FONTS)).toEqual({
      "look.font-primary": "Arial",
      "look.font-secondary": "Bitter",
    });
    expect(await project.questions()).toMatchObject([
      { signalName: open.signalName, status: "answered" },
      { signalName: reopened.signalName, status: "answered" },
    ]);
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);
