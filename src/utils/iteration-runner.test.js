import { runIterationBatch } from './iteration-runner.js';

describe('runIterationBatch', () => {
  it('runs tasks with a maximum pool size', async () => {
    const hints = Array.from({ length: 6 }, (_, index) => `hint-${index}`);
    const active = [];
    const maxSeen = [];

    await runIterationBatch({
      hints,
      poolSize: 2,
      taskFactory: async (index, hint) => {
        active.push(index);
        maxSeen.push(active.length);
        expect(hint).toBe(`hint-${index}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active.splice(active.indexOf(index), 1);
      },
    });

    expect(Math.max(...maxSeen)).toBeLessThanOrEqual(2);
  });

  it('emits progress events for failures', async () => {
    const hints = ['a'];
    const errors = [];

    await runIterationBatch({
      hints,
      taskFactory: async () => {
        throw new Error('boom');
      },
      onProgress: ({ ok, error }) => {
        if (!ok) errors.push(error.message);
      },
    });

    expect(errors).toEqual(['boom']);
  });

  it('validates input types', async () => {
    await expect(runIterationBatch({ hints: null, taskFactory: async () => {} })).rejects.toThrow(TypeError);
    await expect(runIterationBatch({ hints: [], taskFactory: null })).rejects.toThrow(TypeError);
  });

  it('resolves immediately when no hints are provided', async () => {
    const taskFactory = jest.fn();
    await runIterationBatch({ hints: [], taskFactory });
    expect(taskFactory).not.toHaveBeenCalled();
  });

  it('short-circuits when pool size is zero', async () => {
    const taskFactory = jest.fn();
    await runIterationBatch({ hints: ['a', 'b'], poolSize: 0, taskFactory });
    expect(taskFactory).not.toHaveBeenCalled();
  });
});
