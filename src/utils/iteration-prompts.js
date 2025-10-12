import { DEFAULT_SAMPLING } from './iteration-api.js';

export function diversityDeck() {
  return [
    'slightly warmer palette; gentler contrast',
    'slightly cooler palette; crisper contrast',
    'increase textile presence; softer layering',
    'reduce textiles; cleaner lines, fewer throws',
    'airier layout with more negative space',
    'denser, cozier seating cluster',
    'wood-forward materials; minimize metal',
    'metal accents slightly emphasized; reduce wood',
    'soft evening lighting (~2700–3000K), cozy ambience',
    'neutral daytime lighting (~4000–4500K), clear ambience',
    'tone-on-tone, low-contrast composition',
    'bolder accents; stronger figure-ground definition',
  ];
}

export function buildIterationPrompt({
  roomBrief,
  purpose,
  roundGuidance,
  favoritesTextBlock,
  diversityHint,
}) {
  return [
    'Use the attached base room photo as fixed camera pose and architectural envelope.',
    'If reference images are attached, transfer only their style (palette, textures, furniture mood, lighting mood)—not geometry.',
    'Consider the following guidance:',
    `• Room brief (silent): ${roomBrief || 'None'}`,
    `• Intended use: ${purpose || 'None'}`,
    `• User’s global guidance for this round: ${roundGuidance || 'None'}`,
    `• Selected favorites (as free-text, raw): ${favoritesTextBlock || 'None'}`,
    '',
    `Diversity hint for this image: ${diversityHint || 'None'}`,
    '',
    'Generate ONE updated interior variant at 1024×682. Preserve perspective and room envelope.',
    'Return ONE image and ONE short free-text paragraph (single paragraph) describing the mood, the key changes vs the base, and 2–3 ideas for the next iteration. Avoid logos/text.',
  ].join('\n');
}

export async function runIterationBatch({
  api,
  base64Main,
  mimeMain,
  references,
  roomBrief,
  purpose,
  roundGuidance,
  favoritesTextBlock,
  sampling = DEFAULT_SAMPLING,
  onProgress,
}) {
  if (!api || typeof api.generateVariant !== 'function') {
    throw new Error('api with generateVariant is required');
  }
  const deck = diversityDeck();
  const tasks = deck.map((hint, index) => async () => {
    const promptText = buildIterationPrompt({
      roomBrief,
      purpose,
      roundGuidance,
      favoritesTextBlock,
      diversityHint: hint,
    });
    try {
      const result = await api.generateVariant({
        promptText,
        base64Main,
        mimeMain,
        references,
        sampling,
      });
      onProgress?.({ index, ok: true, result, hint });
    } catch (error) {
      onProgress?.({ index, ok: false, error, hint });
    }
  });
  await pool(tasks, 6);
}

export function buildFinalizationPrompt() {
  return [
    'Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target.',
    'Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition).',
    'Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any “avoid” reminders. Avoid logos/text.',
  ].join(' ');
}

async function pool(taskFns, size) {
  let cursor = 0;
  const running = new Set();

  async function launchNext() {
    if (cursor >= taskFns.length) return;
    const fn = taskFns[cursor++];
    const promise = fn().finally(() => running.delete(promise));
    running.add(promise);
    if (running.size < size) {
      await launchNext();
    }
  }

  const starters = Math.min(size, taskFns.length);
  for (let i = 0; i < starters; i += 1) {
    await launchNext();
  }

  while (running.size > 0) {
    await Promise.race([...running]);
    await launchNext();
  }
}
