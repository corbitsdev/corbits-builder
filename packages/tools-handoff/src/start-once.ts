import { Refusal } from "./refusal.ts";

// A turn's tool calls run concurrently (INFERENCE.md "Parallel execution"), so two starts of one
// unbounded role in the same turn would both find it missing from inFlight.
const starting = new Set<string>();
export async function startOnce<T>(
  key: string,
  role: string,
  start: () => Promise<T>,
): Promise<T> {
  if (starting.has(key))
    throw new Refusal(
      role + "_starting: a " + role + " is already starting for this project",
    );
  starting.add(key);
  try {
    return await start();
  } finally {
    starting.delete(key);
  }
}
