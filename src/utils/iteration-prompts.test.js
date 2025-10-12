import {
  buildRoomBriefPrompt,
  buildIterationPrompt,
  buildFavoritesTextBlock,
  buildFinalizationPrompt,
  deckForRound,
} from './iteration-prompts.js';

describe('iteration prompts', () => {
  it('builds room brief prompt including purpose and notes', () => {
    const prompt = buildRoomBriefPrompt({
      purpose: 'Reading nook',
      notes: 'South-facing window',
    });
    expect(prompt).toContain('Reading nook');
    expect(prompt).toContain('South-facing window');
    expect(prompt.split('\n').length).toBeGreaterThanOrEqual(19);
  });

  it('builds iteration prompt with diversity hint and favorites', () => {
    const prompt = buildIterationPrompt({
      roomBrief: 'Paragraph',
      purpose: 'Guest room',
      roundGuidance: 'Add warm lighting',
      favoritesTextBlock: '(1) Keep the sofa',
      diversityHint: 'tone-on-tone',
    });
    expect(prompt).toContain('tone-on-tone');
    expect(prompt).toContain('Add warm lighting');
    expect(prompt).toContain('Selected favorites');
    expect(prompt).toContain('Paragraph');
  });

  it('fills in default placeholders when values are missing', () => {
    const prompt = buildIterationPrompt({
      roomBrief: '',
      purpose: '',
      roundGuidance: '',
      favoritesTextBlock: '',
      diversityHint: '',
    });
    expect(prompt).toContain('Room brief (silent): None');
    expect(prompt).toContain('Intended use: None');
    expect(prompt).toContain('User’s global guidance for this round: None');
    expect(prompt).toContain('Selected favorites (as free-text, raw): None');
    expect(prompt).toContain('Diversity hint for this image: None');
  });

  it('builds favorites text block with notes', () => {
    const block = buildFavoritesTextBlock([
      {
        tiles: [
          { fav: true, text: 'Calm mood', note: 'Use brass lamp' },
          { fav: false, text: 'Ignore' },
        ],
      },
      {
        tiles: [{ fav: true, text: 'Darker palette', note: '' }],
      },
    ]);
    expect(block).toContain('(1) Calm mood [note: Use brass lamp]');
    expect(block).toContain('(2) Darker palette');
  });

  it('returns empty favorites block when nothing selected', () => {
    expect(buildFavoritesTextBlock([{ tiles: [{ fav: false }] }])).toBe('');
  });

  it('builds finalization prompt with hi-res instructions', () => {
    const prompt = buildFinalizationPrompt();
    expect(prompt).toContain('1536×1024');
    expect(prompt).toContain('Build Notes');
  });

  it('provides a 12-item diversity deck', () => {
    const deck = deckForRound();
    expect(deck).toHaveLength(12);
    const unique = new Set(deck);
    expect(unique.size).toBe(deck.length);
  });
});
