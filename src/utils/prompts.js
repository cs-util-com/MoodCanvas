import { diversityDeck } from './diversity.js';

export function buildRoomBriefPrompt({ purpose, notes }) {
  return [
    'ROLE: Create a concise, practical “room brief” for interior styling iterations.',
    '',
    `INPUTS:\n- Base room photo (camera pose and architectural envelope must be preserved)\n- Intended use: ${
      purpose?.trim() || 'None'
    }\n- Notes from user (optional): ${notes?.trim() || 'None'}`,
    '',
    'OUTPUT FORMAT (plain text only, no headings, no markdown):',
    '1) One paragraph (~60–90 words) summarizing the room’s light, openings, proportions and key opportunities/risks, with the intended use as priority.',
    '2) Then 3–5 bullets (one line each) of strict constraints/guidelines.',
    '',
    'CONSTRAINT HINTS (pick only what’s relevant; do not list all):',
    '• Keep camera pose & envelope; no structural changes unless explicitly asked later.',
    '• 60–30–10 color planning (dominant–secondary–accent).',
    '• Circulation clearance ~0.9 m in main paths; avoid cluttered layouts.',
    '• Sofa–table reach ≈0.35–0.45 m OR desk depth ≥0.60 m depending on use.',
    '• Rug sizing: front legs of seating on rug; workspace rug fully under chair.',
    '• Curtains: rod 10–15 cm above head; total width ≈2× opening.',
    '• Layered lighting: ambient + task + accent; evening ~2700–3000 K.',
  ].join('\n');
}

export function favoritesToTextBlock(favorites) {
  if (!Array.isArray(favorites) || favorites.length === 0) {
    return '';
  }
  return favorites
    .map((fav, index) => {
      const base = fav.text?.trim() || '(descriptor missing)';
      const note = fav.note?.trim();
      const label = `Favorite ${index + 1}`;
      return note ? `${label}: ${base} — Note: ${note}` : `${label}: ${base}`;
    })
    .join('\n');
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
    `• Intended use: ${purpose?.trim() || 'None'}`,
    `• User’s global guidance for this round: ${roundGuidance?.trim() || 'None'}`,
    `• Selected favorites (as free-text, raw): ${favoritesTextBlock || 'None'}`,
    '',
    `Diversity hint for this image: ${diversityHint || 'None'}`,
    '',
    'Generate ONE updated interior variant at 1024×682. Preserve perspective and room envelope.',
    'Return ONE image and ONE short free-text paragraph (single paragraph) describing the mood, the key changes vs the base, and 2–3 ideas for the next iteration. Avoid logos/text.',
  ].join('\n');
}

export function buildFinalizationPrompt() {
  return [
    'Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target.',
    'Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition).',
    'Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any “avoid” reminders. Avoid logos/text.',
  ].join(' ');
}

export async function runIterationBatch({
  base64Main,
  mimeMain,
  references = [],
  roomBrief,
  purpose,
  roundGuidance,
  favoritesTextBlock,
  sampling,
  generateVariant,
  onProgress,
  deck = diversityDeck(),
}) {
  if (typeof generateVariant !== 'function') {
    throw new TypeError('generateVariant is required');
  }
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
        promptText,
        base64Main,
        mimeMain,
        references,
        sampling,
      });
      onProgress?.({ index, ok: true, result });
    } catch (error) {
      onProgress?.({ index, ok: false, error });
    }
  });
  await pool(tasks, 6);
}

async function pool(taskFns, size) {
  let next = 0;
  const running = new Set();

  async function startNext() {
    if (next >= taskFns.length) {
      return;
    }
    const fn = taskFns[next++];
    const promise = fn().finally(() => running.delete(promise));
    running.add(promise);
    if (running.size < size) {
      await startNext();
    }
  }

  const starters = Math.min(size, taskFns.length);
  for (let index = 0; index < starters; index += 1) {
    await startNext();
  }
  while (next < taskFns.length) {
    await Promise.race(running);
    await startNext();
  }
  await Promise.allSettled(running);
}
