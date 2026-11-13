// check-stack: checks a project that started from no starter the way Builder's builds check does:
// runs each command CHECKS.txt lists, in order, and stops at the first that fails, with its output.
// Exits non-zero when one fails or the file lists none.
import { failedCommand } from "./steps.ts";

const FILE = "CHECKS.txt";

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    `check-stack   run each command in ${FILE}, in order, stopping at the first that fails`,
  );
  process.exit(0);
}

const listed = Bun.file(FILE);
const commands = (await listed.exists())
  ? (await listed.text())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
  : [];
if (commands.length === 0) {
  console.log(
    `check failed: ${FILE} lists no commands. Write the commands that prove the project installs, builds and passes its tests into ${FILE} at the workspace root, one per line, in the order they run.`,
  );
  process.exit(1);
}

for (const [step, command] of commands.entries()) {
  const failed = await failedCommand(["/bin/sh", "-c", command]);
  if (failed === undefined) continue;
  console.log(`check failed: ${command} exited non-zero`);
  for (const passed of commands.slice(0, step)) console.log(`✓ ${passed}`);
  console.log(`✗ ${command}`);
  if (failed.trim()) console.log(failed.trimEnd().replace(/^/gm, "    "));
  const skipped = commands.slice(step + 1);
  if (skipped.length) console.log(`did not run: ${skipped.join(", then ")}`);
  process.exit(1);
}
console.log(`check passed: every command in ${FILE} succeeded`);
for (const command of commands) console.log(`✓ ${command}`);
