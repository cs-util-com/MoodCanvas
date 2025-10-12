export async function runLimitedPool({ count, limit, worker, onProgress }) {
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError('count must be a non-negative integer');
  }
  if (count === 0) return [];
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError('limit must be a positive integer');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('worker must be a function');
  }

  const results = new Array(count);
  let nextIndex = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    const launchNext = () => {
      if (nextIndex >= count) {
        if (active === 0) {
          resolve(results);
        }
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      active += 1;
      Promise.resolve()
        .then(() => worker(index))
        .then(
          (value) => {
            results[index] = { status: 'fulfilled', value };
            onProgress?.(index, results[index]);
          },
          (error) => {
            results[index] = { status: 'rejected', reason: error };
            onProgress?.(index, results[index]);
          }
        )
        .finally(() => {
          active -= 1;
          launchNext();
        });
    };

    for (let i = 0; i < Math.min(limit, count); i += 1) {
      launchNext();
    }
  });
}

