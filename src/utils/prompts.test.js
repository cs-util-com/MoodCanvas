import {
  buildRoomBriefPrompt,
  buildIterationPrompt,
  buildFinalizationPrompt,
  stringifyFavorites,
} from './prompts.js';

describe('buildRoomBriefPrompt', () => {
  it('injects purpose and notes into the template', () => {
    const prompt = buildRoomBriefPrompt({ purpose: 'Reading nook', notes: 'North light, low ceilings' });
    expect(prompt).toContain('Reading nook');
    expect(prompt).toContain('North light, low ceilings');
    expect(prompt.split('\n').length).toBeGreaterThan(5);
  });
});

describe('buildIterationPrompt', () => {
  it('includes the diversity hint and guidance', () => {
    const prompt = buildIterationPrompt({
      roomBrief: 'Compact room with generous evening light',
      purpose: 'Home office',
      roundGuidance: 'Explore layered lighting',
      favoritesTextBlock: '(1) Soft organic layout',
      diversityHint: 'slightly warmer palette',
    });
    expect(prompt).toContain('Compact room with generous evening light');
    expect(prompt).toContain('Home office');
    expect(prompt).toContain('Explore layered lighting');
    expect(prompt).toContain('(1) Soft organic layout');
    expect(prompt).toContain('slightly warmer palette');
    expect(prompt).toContain('1024×682');
  });

  it('falls back to “None” when data is empty', () => {
    const prompt = buildIterationPrompt({ roomBrief: '', purpose: '', roundGuidance: '', favoritesTextBlock: '', diversityHint: '' });
    expect(prompt).toContain('Room brief (silent): None');
    expect(prompt).toContain('Intended use: None');
    expect(prompt).toContain('Selected favorites (as free-text, raw): None');
  });
});

describe('buildFinalizationPrompt', () => {
  it('mentions the high-resolution requirements and build notes', () => {
    const prompt = buildFinalizationPrompt();
    expect(prompt).toContain('1536×1024');
    expect(prompt).toContain('Build Notes');
  });
});

describe('stringifyFavorites', () => {
  it('returns a concatenated string with notes when provided', () => {
    const block = stringifyFavorites([
      { text: 'Cozy layered textiles', note: 'Keep low contrast' },
      { text: 'Introduce sculptural floor lamp' },
    ]);
    expect(block).toContain('(1) Cozy layered textiles [note: Keep low contrast]');
    expect(block).toContain('(2) Introduce sculptural floor lamp');
  });

  it('returns an empty string when there are no favorites', () => {
    expect(stringifyFavorites([])).toBe('');
  });
});
