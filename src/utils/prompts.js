const ROOM_BRIEF_HINTS = [
  'Keep camera pose & envelope; no structural changes unless explicitly asked later.',
  '60–30–10 color planning (dominant–secondary–accent).',
  'Circulation clearance ~0.9 m in main paths; avoid cluttered layouts.',
  'Sofa–table reach ≈0.35–0.45 m OR desk depth ≥0.60 m depending on use.',
  'Rug sizing: front legs of seating on rug; workspace rug fully under chair.',
  'Curtains: rod 10–15 cm above head; total width ≈2× opening.',
  'Layered lighting: ambient + task + accent; evening ~2700–3000 K.',
  'If scale is uncertain, keep dimensions conservative and mention low confidence.',
];

export function buildRoomBriefPrompt({ purpose, notes }) {
  const intendedUse = normalizePromptValue(purpose);
  const userNotes = normalizePromptValue(notes);
  return [
    'ROLE: Create a concise, practical “room brief” for interior styling iterations.',
    '',
    'INPUTS:',
    '- Base room photo (camera pose and architectural envelope must be preserved)',
    `- Intended use: ${intendedUse}`,
    `- Notes from user (optional): ${userNotes}`,
    '',
    'OUTPUT FORMAT (plain text only, no headings, no markdown):',
    '1) One paragraph (~60–90 words) summarizing the room’s light, openings, proportions and key opportunities/risks, with the intended use as priority.',
    '2) Then 3–5 bullets (one line each) of strict constraints/guidelines.',
    '',
    'CONSTRAINT HINTS (pick only what’s relevant; do not list all):',
    ...ROOM_BRIEF_HINTS,
    'Avoid logos/text and unrealistic geometry.',
  ].join('\n');
}

export function buildIterationPrompt({ roomBrief, purpose, roundGuidance, favoritesTextBlock, diversityHint }) {
  return [
    'Use the attached base room photo as fixed camera pose and architectural envelope.',
    'If reference images are attached, transfer only their style (palette, textures, furniture mood, lighting mood)—not geometry.',
    'Consider the following guidance:',
    `• Room brief (silent): ${normalizePromptValue(roomBrief)}`,
    `• Intended use: ${normalizePromptValue(purpose)}`,
    `• User’s global guidance for this round: ${normalizePromptValue(roundGuidance)}`,
    `• Selected favorites (as free-text, raw): ${normalizePromptValue(favoritesTextBlock)}`,
    '',
    `Diversity hint for this image: ${normalizePromptValue(diversityHint)}`,
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

export function stringifyFavorites(favorites) {
  if (!Array.isArray(favorites) || favorites.length === 0) {
    return '';
  }
  return favorites
    .map((item, index) => {
      const descriptor = typeof item?.text === 'string' && item.text.trim().length > 0
        ? item.text.trim()
        : '(no descriptor)';
      const note = typeof item?.note === 'string' && item.note.trim().length > 0
        ? ` [note: ${item.note.trim()}]`
        : '';
      return `(${index + 1}) ${descriptor}${note}`;
    })
    .join(' ');
}

function normalizePromptValue(value) {
  if (value == null) return 'None';
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : 'None';
}
