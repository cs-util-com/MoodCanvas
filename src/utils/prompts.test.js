import {
  buildAnalysisPrompt,
  buildABPrompts,
  buildHeroPrompts,
  buildMiniList,
} from './prompts.js';

describe('prompt builders', () => {
  test('buildAnalysisPrompt returns multiline prompt with defaults', () => {
    const prompt = buildAnalysisPrompt({ intendedUse: 'Living Room', scope: 3, notes: '' });
    expect(prompt).toContain('ROLE: Interior design analyst for empty rooms.');
    expect(prompt).toContain('INTENDED USE: Living Room.');
    expect(prompt).toContain('INTERVENTION SCOPE: 3.');
    expect(prompt).toContain('NOTES: None provided.');
  });

  test('buildABPrompts returns prompts for both axes', () => {
    const prompts = buildABPrompts('Base prompt', {
      axisA: { label: 'Cozy', description: 'Layer warm textures' },
      axisB: { label: 'Minimal', description: 'Streamline surfaces' },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('Cozy');
    expect(prompts[1]).toContain('Minimal');
  });

  test('buildABPrompts throws when required data missing', () => {
    expect(() => buildABPrompts('', null)).toThrow('basePrompt and axes are required');
  });

  test('buildHeroPrompts returns three hero mixes', () => {
    const prompts = buildHeroPrompts('Base prompt', {
      axisA: { label: 'Cozy', description: 'Layer warm textures' },
      axisB: { label: 'Minimal', description: 'Streamline surfaces' },
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain('sweet spot');
  });

  test('buildHeroPrompts throws when base prompt missing', () => {
    expect(() => buildHeroPrompts('', null)).toThrow('basePrompt and axes are required');
  });
});

describe('buildMiniList', () => {
  test('combines quick wins and staples up to five items', () => {
    const analysis = {
      quick_wins: Array.from({ length: 6 }, (_, index) => ({
        title: `Win ${index + 1}`,
        description: `Do thing ${index + 1}`,
      })),
      usage_candidates: [
        { function: 'Living Room', why: 'Best match' },
        { function: 'Home-Office', why: 'Secondary' },
        { function: 'Guest Room', why: 'Tertiary' },
      ],
    };
    const list = buildMiniList(analysis);
    expect(list).toHaveLength(5);
    expect(list[0].name).toBe('Win 1');
    expect(list[3].name).toContain('Living Room');
  });

  test('returns empty list when analysis missing', () => {
    expect(buildMiniList(null)).toEqual([]);
  });

  test('handles missing quick wins gracefully', () => {
    const analysis = {
      usage_candidates: [{ function: 'Living Room', why: 'Best match' }],
    };
    const list = buildMiniList(analysis);
    expect(list).toHaveLength(1);
    expect(list[0].name).toContain('Living Room');
  });
});
