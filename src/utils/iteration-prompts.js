import { diversityDeck } from './diversity.js';

export function buildRoomBriefPrompt({ purpose, notes }) {
  const safePurpose = purpose?.trim() || 'None';
  const safeNotes = notes?.trim() || 'None';
  return [
    'ROLE: Create a concise, practical “room brief” for interior styling iterations.',
    '',
    'INPUTS:',
    '- Base room photo (camera pose and architectural envelope must be preserved)',
    `- Intended use: ${safePurpose}`,
    `- Notes from user (optional): ${safeNotes}`,
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
    '• If scale is uncertain, keep dimensions conservative and mention low confidence.',
    'Avoid logos/text and unrealistic geometry.',
  ].join('\n');
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

export function buildFavoritesTextBlock(rounds) {
  const entries = [];
  rounds.forEach((round) => {
    round.tiles?.forEach((tile) => {
      if (tile?.fav) {
        const note = tile.note?.trim() ? ` [note: ${tile.note.trim()}]` : '';
        entries.push(
          `(${entries.length + 1}) ${tile.text || '(no descriptor)'}${note}`
        );
      }
    });
  });
  return entries.join(' ');
}

export function buildFinalizationPrompt() {
  return [
    'Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target.',
    'Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition).',
    "Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any 'avoid' reminders. Avoid logos/text.",
  ].join(' ');
}

export function deckForRound() {
  return diversityDeck();
}
