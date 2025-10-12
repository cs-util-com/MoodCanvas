export async function runIterationBatch({ hints, taskFactory, poolSize = 6, onProgress }) {
  if (!Array.isArray(hints)) {
    throw new TypeError('hints must be an array');
  }
  if (typeof taskFactory !== 'function') {
    throw new TypeError('taskFactory must be a function');
  }
  const running = new Set();
  let nextIndex = 0;

  async function startNext() {
    /* istanbul ignore next */
    if (nextIndex >= hints.length) return;
    const index = nextIndex++;
    const hint = hints[index];
    const promise = (async () => {
      try {
        const result = await taskFactory(index, hint);
        onProgress?.({ index, ok: true, result });
      } catch (error) {
        onProgress?.({ index, ok: false, error });
      }
    })();
    running.add(promise);
    promise.finally(() => running.delete(promise));
  }

  const starters = Math.min(poolSize, hints.length);
  for (let i = 0; i < starters; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await startNext();
  }

  while (nextIndex < hints.length) {
    if (running.size === 0) break;
    // eslint-disable-next-line no-await-in-loop
    await Promise.race(running);
    // eslint-disable-next-line no-await-in-loop
    await startNext();
  }

  if (running.size > 0) {
    await Promise.allSettled([...running]);
  }
}
