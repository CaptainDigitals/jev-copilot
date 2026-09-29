/** Runs `worker` over `items` with at most `concurrency` in flight. Failures are returned, not thrown. */
export async function runPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<Array<{ item: T; result?: R; error?: unknown }>> {
  const results: Array<{ item: T; result?: R; error?: unknown }> = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index] as T;
      try {
        results[index] = { item, result: await worker(item, index) };
      } catch (error) {
        results[index] = { item, error };
      }
    }
  });
  await Promise.all(lanes);
  return results;
}
