// The caller observes the failure; the queue only needs ordering.
export async function settle(
  operation: Promise<unknown> | undefined,
): Promise<void> {
  await Promise.allSettled([operation]);
}

async function runAfter<T>(previous: Promise<void>, task: () => Promise<T>) {
  await previous;
  return task();
}

export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = runAfter(tail, task);
      tail = settle(result);
      return result;
    },
    idle: () => tail,
  };
}
