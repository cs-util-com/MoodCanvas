const FAVORITE_SEPARATOR = '\n\n';

export function buildRoomBriefPrompt({ purpose, notes }) {
  return [
    'ROLE: Create a concise, practical “room brief” for interior styling iterations.',
    '',
    `INTENDED USE: ${formatValue(purpose)}`,
    `USER NOTES: ${formatValue(notes)}`,
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

export function buildIterationPromptBase({
  roomBrief,
  purpose,
  globalNotes,
  favorites,
}) {
  const sections = [
    'ROLE: Generate updated interior variants for iterative exploration.',
    '',
    `INTENDED USE: ${formatValue(purpose)}`,
  ];

  if (roomBrief) {
    sections.push('ROOM BRIEF PARAGRAPH:', roomBrief.paragraph.trim());
    if (Array.isArray(roomBrief.bullets) && roomBrief.bullets.length > 0) {
      sections.push(
        'ROOM BRIEF BULLETS:',
        roomBrief.bullets.map((bullet) => `- ${bullet}`).join('\n')
      );
    }
  }

  sections.push(`GLOBAL GUIDANCE: ${formatValue(globalNotes)}`);

  if (favorites && favorites.length > 0) {
    const items = favorites
      .map((favorite, index) => {
        const lines = [`Favorite ${index + 1}: ${favorite.text}`];
        if (favorite.note) {
          lines.push(`Note: ${favorite.note}`);
        }
        return lines.join('\n');
      })
      .join(FAVORITE_SEPARATOR);
    sections.push('FAVORITE REFERENCES (verbatim, no summarizing):', items);
  } else {
    sections.push('FAVORITE REFERENCES: None yet.');
  }

  sections.push(
    '',
    'OUTPUT INSTRUCTIONS:',
    '• Generate ONE updated interior variant at 1024×682 using the provided photo (preserve camera pose and envelope).',
    '• Transfer only style cues from reference images (if provided).',
    '• Return ONE image and ONE short free-text paragraph describing mood, key changes vs base, and 2–3 ideas for the next iteration. Avoid lists, headings or markdown.',
    '• Avoid logos, watermarks or text overlays.'
  );

  return sections.join('\n');
}

export function buildIterationPrompt({ basePrompt, diversityHint }) {
  return [basePrompt, '', `DIVERSITY FOCUS: ${diversityHint}`].join('\n');
}

export function buildFinalizationPrompt({ roomBrief, purpose }) {
  const lines = [
    'ROLE: Produce a faithful high-res re-render with build notes.',
    `INTENDED USE: ${formatValue(purpose)}`,
  ];
  if (roomBrief) {
    lines.push(
      'KEY CONSTRAINTS:',
      roomBrief.bullets.map((item) => `- ${item}`).join('\n')
    );
  }
  lines.push(
    '',
    'OUTPUT INSTRUCTIONS:',
    '• Produce ONE faithful high-res re-render at 1536×1024. Polish only; no new composition.',
    '• Return ONE short paragraph of Build Notes (5–7 sentences covering materials/finishes, palette accents, lighting layers including evening, and 1–2 dimensional tips in meters).',
    '• Avoid reminders or bullet lists.'
  );
  return lines.join('\n');
}

export function createDiversityDeck() {
  const axes = [
    'Warm palette emphasis with cozy peach and muted plum accents.',
    'Cool palette emphasis with slate, misty blue and charcoal.',
    'Increase textile richness: layered rugs, soft upholstery, tactile drapery.',
    'Reduce textile presence: sleeker surfaces, subtle fabric usage.',
    'Higher layout density with more layered styling and accent furniture.',
    'Airier layout with negative space and simplified furniture counts.',
    'Emphasize natural wood tones and organic materials.',
    'Highlight refined metal finishes and glass/acrylic accents.',
    'Lower contrast, tonal gradients and gentle transitions.',
    'Bold contrast with decisive light/dark interplay.',
    'Bright daytime lighting with sun-kissed highlights.',
    'Evening mood lighting with warm layered sources.',
  ];
  return shuffle([...axes]);
}

function shuffle(list) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const j = Math.floor(Math.random() * (index + 1));
    [list[index], list[j]] = [list[j], list[index]];
  }
  return list;
}

function formatValue(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : 'None';
}
