import { generateVariant } from './iec-api.js';

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

export function buildIterationPrompt({ roomBrief, purpose, roundGuidance, favoritesTextBlock, diversityHint }) {
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

export function buildRoomBriefPrompt({ purpose, notes }) {
  return [
    'ROLE: Create a concise, practical “room brief” for interior styling iterations.',
    '',
    'INPUTS:',
    `- Base room photo (camera pose and architectural envelope must be preserved)`,
    `- Intended use: ${purpose || 'None'}`,
    `- Notes from user (optional): ${notes || 'None'}`,
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

export function favoritesToBlock(favorites) {
  if (!Array.isArray(favorites) || favorites.length === 0) {
    return '';
  }
  return favorites
    .map((favorite, index) => {
      const descriptor = favorite.descriptorText?.trim();
      if (!descriptor) return '';
      const note = favorite.userNote && favorite.userNote.trim()
        ? ` [note: ${favorite.userNote.trim()}]`
        : '';
      return `(${index + 1}) ${descriptor}${note}`;
    })
    .filter(Boolean)
    .join(' ');
}

export function refsToArray(refs) {
  return Array.isArray(refs) ? refs.slice(0, 2) : [];
}

export function buildFinalizationPrompt() {
  return [
    'Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target.',
    'Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition).',
    'Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any "avoid" reminders. Avoid logos/text.',
  ].join(' ');
}

export async function runIterationBatch({
  base64Main,
  mimeMain,
  references,
  roomBrief,
  purpose,
  roundGuidance,
  favoritesTextBlock,
  sampling,
  onProgress,
  generateVariantImpl = generateVariant,
  hints = diversityDeck(),
}) {
  const tasks = hints.map((hint, index) => async () => {
    const promptText = buildIterationPrompt({
      roomBrief,
      purpose,
      roundGuidance,
      favoritesTextBlock,
      diversityHint: hint,
    });
    try {
      const result = await generateVariantImpl({
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

  if (tasks.length === 0) return;
  await pool(tasks, 6);
}

async function pool(taskFns, size) {
  const concurrency = Math.min(size, taskFns.length);
  const runners = Array.from({ length: concurrency }, (_, offset) => (async () => {
    for (let index = offset; index < taskFns.length; index += concurrency) {
      // eslint-disable-next-line no-await-in-loop
      await taskFns[index]();
    }
  })());
  await Promise.all(runners);
}
