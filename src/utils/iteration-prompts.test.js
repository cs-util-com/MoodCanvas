import {
  diversityDeck,
  buildIterationPrompt,
  buildFinalizationPrompt,
  runIterationBatch,
} from './iteration-prompts.js';

describe('iteration prompts', () => {
  it('provides 12 diversity hints covering multiple axes', () => {
    const deck = diversityDeck();
    expect(deck).toHaveLength(12);
    const unique = new Set(deck);
    expect(unique.size).toBe(deck.length);
    expect(deck.join(' ')).toContain('palette');
    expect(deck.join(' ')).toContain('lighting');
  });

  it('builds an iteration prompt containing all guidance sections', () => {
    const prompt = buildIterationPrompt({
      roomBrief: 'Paragraph here',
      purpose: 'Bedroom',
      roundGuidance: 'lean warmer',
      favoritesTextBlock: 'Favorite descriptor',
      diversityHint: 'slightly warmer palette',
    });
    expect(prompt).toContain('Room brief (silent): Paragraph here');
    expect(prompt).toContain('Intended use: Bedroom');
    expect(prompt).toContain(
      'User’s global guidance for this round: lean warmer'
    );
    expect(prompt).toContain(
      'Selected favorites (as free-text, raw): Favorite descriptor'
    );
    expect(prompt).toContain(
      'Diversity hint for this image: slightly warmer palette'
    );
    expect(prompt).toContain('Do not move, resize, or reshape walls');
    expect(prompt).toContain('Keep doors, windows, and room entries exactly');
    expect(prompt).toContain(
      'transfer only their style (palette, textures, furniture mood, lighting mood)—never their room shape'
    );
  });

  it('uses fallback placeholders when data is missing', () => {
    const prompt = buildIterationPrompt({});
    expect(prompt).toContain('Room brief (silent): None');
    expect(prompt).toContain('Intended use: None');
    expect(prompt).toContain('User’s global guidance for this round: None');
    expect(prompt).toContain('Selected favorites (as free-text, raw): None');
    expect(prompt).toContain('Diversity hint for this image: None');
  });

  it('builds a finalization prompt with hi-res guidance', () => {
    const prompt = buildFinalizationPrompt();
    expect(prompt).toContain('1536×1024');
    expect(prompt).toContain('Build Notes');
    expect(prompt).toContain('room geometry as immutable');
    expect(prompt).toContain('room entries in their original locations');
  });

  it('runs a full iteration batch and surfaces progress events', async () => {
    const results = [];
    const api = {
      generateVariant: jest.fn(),
    };
    api.generateVariant
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({ imageUrl: 'url-1', text: 'desc-1', warnings: [] }),
              0
            )
          )
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('failure')), 0)
          )
      )
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ imageUrl: 'url', text: 'desc', warnings: [] }),
              0
            )
          )
      );

    await runIterationBatch({
      api,
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'brief',
      purpose: 'Bedroom',
      roundGuidance: 'guidance',
      favoritesTextBlock: '',
      onProgress: (event) => results.push(event),
    });

    expect(api.generateVariant).toHaveBeenCalledTimes(12);
    expect(results.some((event) => event.ok === false)).toBe(true);
    expect(results.some((event) => event.ok === true)).toBe(true);
  });

  it('throws when the API object is missing the generateVariant function', async () => {
    await expect(
      runIterationBatch({
        api: {},
        base64Main: 'base',
        mimeMain: 'image/jpeg',
        references: [],
        roomBrief: 'brief',
        purpose: 'Bedroom',
        roundGuidance: '',
        favoritesTextBlock: '',
      })
    ).rejects.toThrow('api with generateVariant is required');
  });
});
