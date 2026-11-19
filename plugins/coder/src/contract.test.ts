import { expect, test } from "bun:test";
import { join } from "node:path";
import { AppStarter } from "@corbits-builder/plugin";
import { STARTER_NAMES, STARTERS } from "./contract.ts";
import workspace from "./workspace.ts";

const BUILDER = Object.keys(workspace.commands);
const listed = async (folder: string, file: string) => {
  const found = Bun.file(join(import.meta.dir, "..", folder, file));
  return (await found.exists())
    ? (await found.text())
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
    : [];
};

// The hub saves a starter's checks as stack.checks and runs them where only the saved code is, while
// check-stack runs CHECKS.txt and then BUILDER-CHECKS.txt in the coder's workspace. A web starter's
// CHECKS.txt once named check-app, so every saved web project failed its builds check on a command
// it did not have.
test("each starter's CHECKS.txt is its saved checks with only the project's own commands, and Builder's checks stay in BUILDER-CHECKS.txt", async () => {
  for (const name of STARTER_NAMES) {
    const { folder, checks } = STARTERS[name];
    const own = await listed(folder, "CHECKS.txt");
    expect(own).toEqual(checks);
    for (const line of own)
      expect(BUILDER.some((command) => line.includes(command))).toBe(false);
    for (const line of await listed(folder, "BUILDER-CHECKS.txt"))
      expect(BUILDER).toContain(line);
  }
  expect(
    await listed(STARTERS["web-app"].folder, "BUILDER-CHECKS.txt"),
  ).toEqual(["check-app"]);
});

// A release replaces the code but keeps the folders production names as holding what people entered,
// so each must be one the code never carries: kept out by the starter's .gitignore.
test("each starter's production data folders are kept out of its code", async () => {
  for (const name of STARTER_NAMES) {
    const { folder, production } = AppStarter.assert(STARTERS[name]);
    if (production === undefined) continue;
    const ignored = await listed(folder, ".gitignore");
    for (const data of production.data) expect(ignored).toContain(`${data}/`);
  }
});
