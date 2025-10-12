import { buildIterationPrompt, deckForRound } from './iteration-prompts.js';
import { generateVariant } from './gemini-iteration.js';

export async function runIterationBatch({
  apiKey,
  base64Main,
  mimeMain,
  references,
  roomBrief,
  purpose,
  roundGuidance,
  favoritesTextBlock,
  sampling,
  fetchImpl,
  onProgress,
  deck = deckForRound(),
  poolSize = 6,
}) {
  const tasks = deck.map((hint, index) => async () => {
    const promptText = buildIterationPrompt({
      roomBrief,
      purpose,
      roundGuidance,
      favoritesTextBlock,
      diversityHint: hint,
    });
    try {
      const result = await generateVariant({
        apiKey,
        promptText,
        base64Main,
        mimeMain,
        references,
        sampling,
        fetchImpl,
      });
      onProgress?.({ index, ok: true, result });
    } catch (error) {
      onProgress?.({ index, ok: false, error });
    }
  });
  await pool(tasks, poolSize);
}

async function pool(taskFns, size) {
  let cursor = 0;
  const running = new Set();
  async function startNext() {
    if (cursor >= taskFns.length) {
      return;
    }
    const fn = taskFns[cursor++];
    const promise = fn()
      .catch(() => {})
      .finally(() => {
        running.delete(promise);
      });
    running.add(promise);
    if (running.size < size) {
      await startNext();
    }
  }
  const starters = Math.min(size, taskFns.length);
  for (let index = 0; index < starters; index += 1) {
    await startNext();
  }
  while (cursor < taskFns.length) {
    if (running.size === 0) {
      await startNext();
      continue;
    }
    await Promise.race([...running]);
    await startNext();
  }
  await Promise.allSettled([...running]);
}
