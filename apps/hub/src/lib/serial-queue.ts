export async function settle(
  operation: Promise<unknown> | undefined,
): Promise<void> {
  try {
    await operation;
  } catch {
    // The caller observes the failure; the queue only needs ordering.
  }
}

export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = settle(result);
      return result;
    },
    idle: () => tail,
  };
}
