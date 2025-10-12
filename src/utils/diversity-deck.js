const AXIS_DECK = [
  {
    id: 'palette-warm',
    axis: 'palette',
    label: 'Palette warm',
    instruction: 'Favor warm neutrals, honey wood, and amber highlights while respecting the base envelope.',
  },
  {
    id: 'palette-cool',
    axis: 'palette',
    label: 'Palette cool',
    instruction: 'Shift toward cooler neutrals, graphite metals, and breezy blue accents without changing the layout.',
  },
  {
    id: 'textiles-layered',
    axis: 'textiles',
    label: 'Textiles layered',
    instruction: 'Introduce plush textiles, layered drapery, and tactile upholstery moments for softness.',
  },
  {
    id: 'textiles-lean',
    axis: 'textiles',
    label: 'Textiles lean',
    instruction: 'Keep textiles minimal and crisp, highlighting architectural lines and smooth finishes.',
  },
  {
    id: 'layout-open',
    axis: 'layout-density',
    label: 'Layout open',
    instruction: 'Keep circulation wide with pulled-back furnishings and breathable spacing (≥90 cm walkways).',
  },
  {
    id: 'layout-cozy',
    axis: 'layout-density',
    label: 'Layout cozy',
    instruction: 'Densify seating clusters and layer accent tables while preserving safe walk paths.',
  },
  {
    id: 'materials-wood',
    axis: 'materials',
    label: 'Materials wood-forward',
    instruction: 'Lean into wood tones and natural fibers for the primary surfaces and large furniture.',
  },
  {
    id: 'materials-metal',
    axis: 'materials',
    label: 'Materials metal-forward',
    instruction: 'Emphasize metal details, sleek hardware, and reflective accents alongside the base architecture.',
  },
  {
    id: 'contrast-high',
    axis: 'contrast',
    label: 'Contrast high',
    instruction: 'Increase contrast with deliberate dark-light pairings while maintaining a cohesive palette.',
  },
  {
    id: 'contrast-soft',
    axis: 'contrast',
    label: 'Contrast soft',
    instruction: 'Blend tonal values gently for a calm, low-contrast look with gentle gradients.',
  },
  {
    id: 'lighting-day',
    axis: 'lighting',
    label: 'Lighting day',
    instruction: 'Stage bright daytime lighting with diffuse sun, bounced highlights, and minimal artificial glow.',
  },
  {
    id: 'lighting-evening',
    axis: 'lighting',
    label: 'Lighting evening',
    instruction: 'Simulate layered evening lighting with warm sconces, floor lamps, and dimmed overhead wash.',
  },
];

export function buildDiversityDeck(count = 12, offset = 0) {
  if (!Number.isFinite(count) || count < 0) {
    throw new TypeError('count must be a non-negative number');
  }
  if (count === 0) return [];
  const deckLength = AXIS_DECK.length;
  const start = Number.isInteger(offset) ? ((offset % deckLength) + deckLength) % deckLength : 0;

  const result = [];
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    result.push({
      slot: index,
      axis: AXIS_DECK[cursor],
    });
    cursor = (cursor + 1) % deckLength;
  }
  return result;
}

export function summarizeDeck(deck) {
  const summary = new Map();
  for (const entry of deck) {
    const id = entry.axis.id;
    const stats = summary.get(id) ?? { count: 0, label: entry.axis.label };
    stats.count += 1;
    summary.set(id, stats);
  }
  return summary;
}

export const DIVERSITY_AXIS_DECK = AXIS_DECK;

