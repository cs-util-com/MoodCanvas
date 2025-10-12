import {
  buildRoomBriefPrompt,
  buildIterationPromptBase,
  buildIterationPrompt,
  buildFinalizationPrompt,
  createDiversityDeck,
} from './iteration-prompts.js';

describe('iteration prompts', () => {
  test('buildRoomBriefPrompt includes purpose and notes', () => {
    const prompt = buildRoomBriefPrompt({
      purpose: 'Living room',
      notes: 'Low ceiling',
    });
    expect(prompt).toContain('INTENDED USE: Living room');
    expect(prompt).toContain('USER NOTES: Low ceiling');
    expect(prompt).toContain('ROLE: Create a concise');
  });

  test('buildIterationPromptBase embeds room brief and favorites verbatim', () => {
    const base = buildIterationPromptBase({
      roomBrief: {
        paragraph: 'Bright volume with corner windows.',
        bullets: ['Keep circulation clear', 'Layer evening lighting'],
      },
      purpose: 'Reading lounge',
      globalNotes: 'Emphasize quiet corners',
      favorites: [
        {
          text: 'Soft sage palette with low modular seating.',
          note: 'Add bookshelves',
        },
      ],
    });
    expect(base).toContain('ROOM BRIEF PARAGRAPH');
    expect(base).toContain('Reading lounge');
    expect(base).toContain('Favorite 1');
    expect(base).toContain('Note: Add bookshelves');
  });

  test('buildIterationPromptBase omits bullet section when brief has no bullets', () => {
    // Why this test matters: empty bullet arrays should not yield stray headings.
    const base = buildIterationPromptBase({
      roomBrief: { paragraph: 'Only paragraph', bullets: [] },
      purpose: 'Minimal bedroom',
      globalNotes: 'Soft palette',
      favorites: [],
    });
    expect(base).toContain('ROOM BRIEF PARAGRAPH:');
    expect(base).not.toContain('ROOM BRIEF BULLETS:');
  });

  test('buildIterationPrompt appends diversity focus', () => {
    const base = 'Base prompt';
    const prompt = buildIterationPrompt({
      basePrompt: base,
      diversityHint: 'Warm palette focus',
    });
    expect(prompt).toContain(base);
    expect(prompt).toContain('DIVERSITY FOCUS: Warm palette focus');
  });

  test('buildIterationPromptBase falls back when context is missing', () => {
    // Why this test matters: empty inputs are common after a restart and must yield a valid prompt scaffold.
    const base = buildIterationPromptBase({
      roomBrief: null,
      purpose: '',
      globalNotes: '',
      favorites: [],
    });
    expect(base).toContain('INTENDED USE: None');
    expect(base).toContain('GLOBAL GUIDANCE: None');
    expect(base).toContain('FAVORITE REFERENCES: None yet.');
  });

  test('buildIterationPromptBase lists favorites without optional notes', () => {
    // Why this test matters: descriptors without per-favorite notes should remain verbatim.
    const base = buildIterationPromptBase({
      roomBrief: null,
      purpose: 'Gallery',
      globalNotes: 'Keep art wall',
      favorites: [{ text: 'Statement lighting over dining table.' }],
    });
    expect(base).toContain('Favorite 1: Statement lighting over dining table.');
    expect(base).not.toContain('Note:');
  });

  test('buildFinalizationPrompt includes build note instructions', () => {
    const prompt = buildFinalizationPrompt({
      roomBrief: { bullets: ['Keep envelope fixed'] },
      purpose: 'Home office',
    });
    expect(prompt).toContain('ROLE: Produce a faithful high-res');
    expect(prompt).toContain('Home office');
    expect(prompt).toContain('Build Notes');
  });

  test('buildFinalizationPrompt handles missing room brief gracefully', () => {
    // Why this test matters: users can finalize before a room brief is available.
    const prompt = buildFinalizationPrompt({ roomBrief: null, purpose: '' });
    expect(prompt).not.toContain('KEY CONSTRAINTS');
    expect(prompt).toContain('INTENDED USE: None');
  });

  test('createDiversityDeck yields twelve axes', () => {
    const deck = createDiversityDeck();
    expect(deck).toHaveLength(12);
    const unique = new Set(deck);
    expect(unique.size).toBeGreaterThan(8);
  });
});
