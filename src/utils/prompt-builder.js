export function buildRoomBriefPrompt({ purpose }) {
  const purposeLine = purpose?.trim()
    ? `Room purpose: ${purpose.trim()}.`
    : 'Room purpose: not specified — propose flexible ideas that keep the layout adaptable.';

  return [
    'You are an interior design strategist reviewing a real room photo.',
    purposeLine,
    'Produce two sections:',
    '1) Paragraph (60–90 words) summarising the existing mood, spatial opportunities, likely constraints, and what the occupant could achieve.',
    '2) Bullet list (3–5 bullets, 6–12 words each) capturing non-negotiable constraints or reminders.',
    'Always include these heuristics across both sections: keep the existing camera and envelope, respect structural walls/windows, honour 60-30-10 palette discipline, maintain recommended clearances (≥90 cm main paths, ≥45 cm seating), and plan layered lighting (ambient, task, accent) with an evening lighting option.',
    'Write in English, no headings beyond the paragraph and bullets, no JSON.',
  ].join('\n');
}

export function buildIterationPrompt({
  roomBrief,
  purpose,
  globalGuidance,
  favorites = [],
  axis,
}) {
  if (!roomBrief?.paragraph || !Array.isArray(roomBrief?.bullets)) {
    throw new Error('roomBrief with paragraph and bullets is required');
  }
  if (!axis) {
    throw new Error('axis is required for iteration prompts');
  }

  const lines = [
    'You are updating one interior variant for the provided room photo.',
    'Keep the camera, envelope, and proportions identical to the base photo.',
    purpose?.trim()
      ? `Intended purpose: ${purpose.trim()}.`
      : 'No specific purpose provided — keep solutions broadly functional.',
    'Room brief summary (retain intent):',
    roomBrief.paragraph.trim(),
    'Constraints to respect:',
    ...roomBrief.bullets.map((bullet, index) => `${index + 1}. ${bullet}`),
    `Diversity axis focus → ${axis.label}: ${axis.instruction}`,
    'Transfer only style signatures from the reference images. Do not copy their layout or camera.',
  ];

  if (favorites.length > 0) {
    lines.push('Favorite descriptors from the last round (verbatim — build upon them):');
    favorites.forEach((favorite, index) => {
      lines.push(`${index + 1}) ${favorite.descriptor}`);
      if (favorite.note?.trim()) {
        lines.push(`   Note: ${favorite.note.trim()}`);
      }
    });
  }

  if (globalGuidance?.trim()) {
    lines.push(`Global guidance from the user: ${globalGuidance.trim()}`);
  }

  lines.push(
    'Generate ONE updated interior concept at 1024×682. Keep composition and perspective identical. '
      + 'Return ONE image plus ONE short paragraph (single paragraph, ≤90 words) describing the mood, key differences vs the base, '
      + 'and 2–3 concrete ideas for the next iteration. Avoid mentioning text overlays or logos.'
  );

  return lines.join('\n');
}

export function buildDescriptorRepairPrompt({
  roomBrief,
  purpose,
  favorites = [],
  globalGuidance,
  axis,
}) {
  const lines = [
    'A flash-image call returned an image but no descriptor text. Provide a single replacement paragraph (≤90 words).',
    'Describe mood, key differences versus the base photo, and list 2–3 ideas for the next iteration.',
    purpose?.trim()
      ? `Intended purpose: ${purpose.trim()}.`
      : 'No specific purpose provided — keep guidance flexible.',
    `Axis context: ${axis.label} → ${axis.instruction}.`,
    `Room brief paragraph: ${roomBrief?.paragraph ?? ''}`,
  ];

  if (favorites.length > 0) {
    lines.push('Favorite descriptors from this round:');
    favorites.forEach((favorite, index) => {
      lines.push(`${index + 1}) ${favorite.descriptor}`);
      if (favorite.note?.trim()) {
        lines.push(`   Note: ${favorite.note.trim()}`);
      }
    });
  }

  if (globalGuidance?.trim()) {
    lines.push(`User guidance: ${globalGuidance.trim()}`);
  }

  lines.push('Write in English, single paragraph.');
  return lines.join('\n');
}

export function buildFinalizationPrompt({
  roomBrief,
  purpose,
  favorites = [],
}) {
  if (!roomBrief?.paragraph) {
    throw new Error('roomBrief with paragraph is required for finalization');
  }

  const lines = [
    'Produce ONE high-fidelity re-render of the provided candidate image at 1536×1024.',
    'Do not change the camera, envelope, layout, or major composition. Only polish materials, finishes, and styling.',
    purpose?.trim()
      ? `Purpose to respect: ${purpose.trim()}.`
      : 'No specific purpose provided — keep results broadly functional.',
    `Room brief anchor: ${roomBrief.paragraph.trim()}`,
    'Also return ONE paragraph of build notes (5–7 sentences) covering materials/finishes, palette accents, layered lighting (include evening mood), and 1–2 dimensional tips in meters. Do not add reminders or apologies.',
  ];

  if (favorites.length > 0) {
    lines.push('Favorite descriptors informing this final choice:');
    favorites.forEach((favorite, index) => {
      lines.push(`${index + 1}) ${favorite.descriptor}`);
      if (favorite.note?.trim()) {
        lines.push(`   Note: ${favorite.note.trim()}`);
      }
    });
  }

  lines.push('Return exactly one image and the build notes paragraph.');
  return lines.join('\n');
}

export function buildFinalizationRepairPrompt({
  roomBrief,
  purpose,
  favorites = [],
}) {
  const lines = [
    'A flash-image finalization call returned an image without build notes. Provide replacement build notes now.',
    'Write 5–7 sentences covering materials/finishes, palette accents, layered lighting (including evening mode), and 1–2 dimensional tips in meters.',
    purpose?.trim()
      ? `Purpose to respect: ${purpose.trim()}.`
      : 'No specific purpose provided — keep advice flexible.',
    `Room brief anchor: ${roomBrief?.paragraph ?? ''}`,
  ];

  if (favorites.length > 0) {
    lines.push('Favorite descriptors that informed this final selection:');
    favorites.forEach((favorite, index) => {
      lines.push(`${index + 1}) ${favorite.descriptor}`);
      if (favorite.note?.trim()) {
        lines.push(`   Note: ${favorite.note.trim()}`);
      }
    });
  }

  lines.push('Write in English as a single paragraph.');
  return lines.join('\n');
}

