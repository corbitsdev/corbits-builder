import { createHash } from "node:crypto";

// The most hashes a challenge may ask for. Cloudflare asked for 2 million in practice and documents
// 16 million. Anything far past that would take minutes, so this code does not try.
const MAX_WORK = 64_000_000;
// The most checkpoints a challenge may ask for. The proof keeps 32 bytes for each in memory and
// sends them as text. Cloudflare asked for 1,000.
const MAX_CHECKPOINTS = 1_000_000;
// Hashes between yields, about 15 ms each, so the tool's process stays responsive while it solves.
const SLICE = 100_000;

/** A challenge's seed and work, as Cloudflare sends them before it creates a temporary account. */
export type Work = { seed: string; k: number; g: number };

/**
 * Whether this code can solve Cloudflare's challenge: positive whole numbers within the bounds
 * above, and a 32-byte seed.
 */
export function solvable({ seed, k, g }: Work) {
  return (
    Number.isSafeInteger(k) &&
    Number.isSafeInteger(g) &&
    k >= 1 &&
    g >= 1 &&
    k <= MAX_CHECKPOINTS &&
    k * g <= MAX_WORK &&
    Buffer.from(seed, "base64url").length === 32
  );
}

/**
 * Computes the proof Cloudflare asks for. It takes the SHA-256 of the seed, then chains k times g
 * more SHA-256s, keeping the hash after every g. The proof is the k+1 kept hashes in standard
 * base64.

 */
export async function solve(work: Work): Promise<string> {
  if (!solvable(work)) throw new Error("challenge_unsolvable");
  const { k, g } = work;
  const out = Buffer.alloc((k + 1) * 32);
  let current = createHash("sha256")
    .update(Buffer.from(work.seed, "base64url"))
    .digest();
  current.copy(out, 0);
  let since = 0;
  for (let checkpoint = 1; checkpoint <= k; checkpoint++) {
    for (let round = 0; round < g; round++)
      current = createHash("sha256").update(current).digest();
    current.copy(out, checkpoint * 32);
    since += g;
    if (since >= SLICE) {
      since = 0;
      await new Promise((resume) => setTimeout(resume, 0));
    }
  }
  return out.toString("base64");
}
