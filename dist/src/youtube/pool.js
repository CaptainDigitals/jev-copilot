/** Runs `worker` over `items` with at most `concurrency` in flight. Failures are returned, not thrown. */
export async function runPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            const item = items[index];
            try {
                results[index] = { item, result: await worker(item, index) };
            }
            catch (error) {
                results[index] = { item, error };
            }
        }
    });
    await Promise.all(lanes);
    return results;
}
