import { runLimitedPool } from './pool.js';

describe('runLimitedPool', () => {
  it('resolves workers respecting concurrency limit', async () => {
    const order = [];
    const results = await runLimitedPool({
      count: 4,
      limit: 2,
      worker: async (index) => {
        order.push(`start-${index}`);
        await Promise.resolve();
        order.push(`end-${index}`);
        return index * 2;
      },
    });

    expect(results).toHaveLength(4);
    results.forEach((result, index) => {
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(index * 2);
    });
    expect(order.filter((entry) => entry.startsWith('start-')).length).toBe(4);
  });

  it('captures rejections without failing other jobs', async () => {
    const results = await runLimitedPool({
      count: 3,
      limit: 2,
      worker: async (index) => {
        if (index === 1) {
          throw new Error('boom');
        }
        return index;
      },
    });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 0 });
    expect(results[1].status).toBe('rejected');
    expect(results[1].reason).toBeInstanceOf(Error);
    expect(results[2]).toEqual({ status: 'fulfilled', value: 2 });
  });

  it('throws when provided with invalid arguments', async () => {
    await expect(runLimitedPool({ count: -1, limit: 1, worker: () => {} })).rejects.toThrow(TypeError);
    await expect(runLimitedPool({ count: 1, limit: 0, worker: () => {} })).rejects.toThrow(TypeError);
    await expect(runLimitedPool({ count: 1, limit: 1, worker: null })).rejects.toThrow(TypeError);
  });
});

