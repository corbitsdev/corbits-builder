import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { resumeMessage } from "../config/resume.ts";
import { specialistEndedMessage } from "../config/specialist-ended.ts";
import { readDurableConversationTurns } from "./conversation-turns.ts";

const person = "b65b0e2f4c4a444db11b7321dc413964@sunny-harbor-panda.localhost";
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

// A run repo whose committed coordinator mirror holds these inbound messages, with the CRLF line breaks mail delivers.
async function runRepo(inbound: { from: string; text: string }[]) {
  const dir = await mkdtemp(join(tmpdir(), "sb-conversation-turns-"));
  dirs.push(dir);
  const wal = join(dir, "agent-state", "coordinate", "wal", "0");
  await mkdir(wal, { recursive: true });
  const turns = inbound.map(({ from, text }, at) => ({
    role: "user",
    content: [
      {
        type: "text",
        text: `[From: ${from}]\n\n${text.replaceAll("\n", "\r\n")}`,
      },
    ],
    timestamp: at + 1,
  }));
  const metadata = {
    pendingOperations: [],
    tokenUsage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      thinking: 0,
    },
    connectorState: null,
  };
  await writeFile(
    join(wal, "0.json"),
    JSON.stringify({ seq: 0, turns, metadata }),
  );
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  await $`git init -q -b main ${dir}`.env(env);
  await $`git -C ${dir} add -A`.env(env);
  await $`git -C ${dir} -c commit.gpgsign=false commit -q -m mirror`.env(env);
  return dir;
}

const decisions = () =>
  runRepo([
    { from: person, text: "Sure" },
    { from: "signal@local", text: JSON.stringify({ outcome: "approved" }) },
    { from: "signal@local", text: JSON.stringify({ outcome: "rejected" }) },
    {
      from: "signal@local",
      text: JSON.stringify({ outcome: "rejected", message: "Keep it free" }),
    },
    {
      from: "signal@local",
      text: JSON.stringify({ outcome: "approved", message: "  " }),
    },
  ]);

const personTexts = async (
  dir: string,
  approvalDecisions: "note" | "decision",
) =>
  (
    await readDurableConversationTurns({
      repoStore: { getRepoDir: () => dir },
      address:
        "run_04ba732b8686649f77a2797393bafbc5@sunny-harbor-panda.localhost",
      approvalDecisions,
    })
  ).map(({ role, text }) => ({ role, text }));

test("page turns keep only the note sent with an approval decision", async () => {
  expect(await personTexts(await decisions(), "note")).toEqual([
    { role: "person", text: "Sure" },
    { role: "person", text: "Keep it free" },
  ]);
});

test("resume turns read each approval decision as a plain line", async () => {
  expect(await personTexts(await decisions(), "decision")).toEqual([
    { role: "person", text: "Sure" },
    { role: "person", text: "Approved a request." },
    { role: "person", text: "Rejected a request." },
    { role: "person", text: "Rejected a request: Keep it free" },
    { role: "person", text: "Approved a request." },
  ]);
});

test("a person's words read back with the line breaks they typed", async () => {
  const typed =
    'I dont get this one bit\n\nOn "Constraints" v1:\n\n> Use $5 per month';
  const dir = await runRepo([
    { from: person, text: typed },
    { from: person, text: "Sure" },
  ]);
  expect(await personTexts(dir, "note")).toEqual([
    { role: "person", text: typed },
    { role: "person", text: "Sure" },
  ]);
});

test("a specialist-ended notice reads back without its coordinator-only part", async () => {
  const notice = specialistEndedMessage({
    role: "writer",
    status: "failed",
    reason: { message: "provider refused the request" },
  });
  const dir = await runRepo([{ from: person, text: notice }]);
  expect(await personTexts(dir, "note")).toEqual([
    {
      role: "person",
      text: "Status update: The writer stopped before finishing.",
    },
  ]);
});

test("a resumed message reads back without its held context", async () => {
  const context =
    "Background: this project's conversation continues from an earlier session. This is where it stood, not a new request.\n\nEarlier conversation, oldest first:\n\nPerson: hi";
  const dir = await runRepo([
    { from: person, text: resumeMessage(context, "Line one\n\nLine two") },
  ]);
  expect(await personTexts(dir, "note")).toEqual([
    { role: "person", text: "Line one\n\nLine two" },
  ]);
});

test("a person's own message with the notice lead reads back whole", async () => {
  const typed = "Status update: done\n\nmore details";
  const dir = await runRepo([{ from: person, text: typed }]);
  expect(await personTexts(dir, "note")).toEqual([
    { role: "person", text: typed },
  ]);
});

test("a resumed message with no words leaves no turn", async () => {
  const context =
    "Background: this project's conversation continues from an earlier session. This is where it stood, not a new request.\n\nEarlier conversation, oldest first:\n\nPerson: hi";
  const dir = await runRepo([
    { from: person, text: resumeMessage(context, " ") },
  ]);
  expect(await personTexts(dir, "note")).toEqual([]);
});

test("a resumed message is read after the separator, not at a quoted line that starts like it", async () => {
  const context =
    "Background: this project's conversation continues from an earlier session. This is where it stood, not a new request.\n\nEarlier conversation, oldest first:\n\nPerson: hi\n\nThe person's new message: quoted earlier";
  const dir = await runRepo([
    { from: person, text: resumeMessage(context, "Real words") },
  ]);
  expect(await personTexts(dir, "note")).toEqual([
    { role: "person", text: "Real words" },
  ]);
});
