import { realpath } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createPosixTools } from "@intx/tools-posix";
import { type } from "arktype";

// A single native tool invocation, with no agent loop, provider access or
// inherited operator environment. The parent owns OS isolation and limits.
const Call = type({
  "+": "reject",
  id: "string > 0",
  name: "'read_file' | 'write_file' | 'edit_file' | 'run_shell' | 'search_files' | 'grep'",
  arguments: { "[string]": "unknown" },
});

const HostGateCall = type({
  "+": "reject",
  id: "string > 0",
  name: "'__sb_host_gate'",
  arguments: {
    "+": "reject",
    nonce: "string > 0",
    argv: "string[]",
    cwd: "string",
    timeoutMs: "number.integer > 0",
    maxOutputBytes: "number.integer > 0",
  },
});
export async function runHostGate(
  workspace: string,
  options: typeof HostGateCall.infer.arguments,
) {
  const root = await realpath(workspace),
    cwd = await realpath(resolve(root, options.cwd));
  const tail = relative(root, cwd);
  if (
    tail === ".." ||
    tail.startsWith("../") ||
    !options.argv.length ||
    options.argv.some((arg) => arg.includes("\0"))
  )
    throw new Error("host_gate_scope_refused");
  const child = Bun.spawn(options.argv, {
    cwd,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: root,
      TMPDIR: root,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let timedOut = false,
    outputLimited = false,
    total = 0;
  const stop = () => {
    child.kill("SIGKILL");
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, options.timeoutMs);
  const capture = async (stream: ReadableStream<Uint8Array>) => {
    const hash = new Bun.CryptoHasher("sha256"),
      reader = stream.getReader();
    let bytes = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.length;
        total += item.value.length;
        if (total > options.maxOutputBytes) {
          outputLimited = true;
          stop();
        }
        hash.update(item.value);
      }
      return { sha256: hash.digest("hex"), bytes };
    } finally {
      reader.releaseLock();
    }
  };
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      capture(child.stdout),
      capture(child.stderr),
      child.exited,
    ]);
    return {
      nonce: options.nonce,
      exitCode: timedOut || outputLimited ? null : exitCode,
      timedOut,
      outputLimited,
      stdout: timedOut || outputLimited ? null : stdout,
      stderr: timedOut || outputLimited ? null : stderr,
    };
  } finally {
    clearTimeout(timer);
    stop();
    await child.exited;
  }
}

if (import.meta.main) {
  try {
    const raw = JSON.parse(await Bun.stdin.text());
    const host = HostGateCall(raw);
    const call = host instanceof type.errors ? Call.assert(raw) : host;
    const cwd = process.argv[2];
    if (!cwd) throw new Error("missing_workspace");
    if (!(host instanceof type.errors)) {
      console.log(
        JSON.stringify({
          callId: host.id,
          content: JSON.stringify(await runHostGate(cwd, host.arguments)),
        }),
      );
      process.exit(0);
    }
    const tools = createPosixTools({ cwd });
    try {
      console.log(
        JSON.stringify(await tools.run(call, new AbortController().signal)),
      );
    } finally {
      await tools.dispose();
    }
  } catch (error) {
    // The parent surfaces this stderr in its sandbox_tool_process_failed error.
    console.error(error instanceof Error ? error.message : String(error));
    console.log(JSON.stringify({ error: "native_tool_execution_failed" }));
    process.exitCode = 1;
  }
}
