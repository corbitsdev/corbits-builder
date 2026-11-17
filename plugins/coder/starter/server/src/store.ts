import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

// The app's data lives in JSON files under server/data, one per collection, validated on every read
// and written atomically, so a crash mid-write never leaves a half-written file.
export function createStore<T>(name: string, schema: z.ZodType<T>, initial: T) {
  const path = new URL(`../data/${name}.json`, import.meta.url).pathname;
  let queue = Promise.resolve();
  const read = async (): Promise<T> => {
    const file = Bun.file(path);
    return (await file.exists()) ? schema.parse(await file.json()) : initial;
  };
  const write = async (value: T) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path + ".tmp",
      JSON.stringify(schema.parse(value), null, 2),
    );
    await rename(path + ".tmp", path);
  };
  return {
    read,
    // Updates run one at a time, so two requests never overwrite each other's change.
    update: (change: (value: T) => T | Promise<T>): Promise<T> => {
      const result = queue.then(async () => {
        const next = await change(await read());
        await write(next);
        return next;
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
