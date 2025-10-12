import {
  buildRoomBriefPrompt,
  favoritesToTextBlock,
  buildIterationPrompt,
  buildFinalizationPrompt,
  runIterationBatch,
} from './prompts.js';

describe('buildRoomBriefPrompt', () => {
  it('injects purpose and notes into the prompt', () => {
    const prompt = buildRoomBriefPrompt({
      purpose: 'Evening lounge',
      notes: 'Highlight layered lighting',
    });
    expect(prompt).toContain('Intended use: Evening lounge');
    expect(prompt).toContain(
      'Notes from user (optional): Highlight layered lighting'
    );
    expect(prompt).toContain(
      'Layered lighting: ambient + task + accent; evening ~2700–3000 K.'
    );
  });

  it('falls back to "None" when purpose or notes are missing', () => {
    const prompt = buildRoomBriefPrompt({ purpose: '', notes: '' });
    expect(prompt).toContain('Intended use: None');
    expect(prompt).toContain('Notes from user (optional): None');
  });
});

describe('favoritesToTextBlock', () => {
  it('concatenates descriptors and notes into lines', () => {
    const block = favoritesToTextBlock([
      {
        text: 'Warm palette with diffused wall lights',
        note: 'Keep wall sconces',
      },
      { text: 'Airier layout with sculptural chair' },
    ]);
    expect(block.split('\n')).toHaveLength(2);
    expect(block).toContain(
      'Favorite 1: Warm palette with diffused wall lights — Note: Keep wall sconces'
    );
    expect(block).toContain('Favorite 2: Airier layout with sculptural chair');
  });

  it('returns an empty string when no favorites are supplied', () => {
    expect(favoritesToTextBlock([])).toBe('');
  });

  it('returns an empty string when input is not an array', () => {
    expect(favoritesToTextBlock(null)).toBe('');
  });
});

describe('buildIterationPrompt', () => {
  it('builds a multi-line guidance block with diversity hint', () => {
    const prompt = buildIterationPrompt({
      roomBrief: 'North-facing room with generous glazing.',
      purpose: 'Reading nook',
      roundGuidance: 'Integrate a dedicated reading chair.',
      favoritesTextBlock: 'Favorite 1: Soft boucle chair with brass floor lamp',
      diversityHint: 'slightly warmer palette; gentler contrast',
    });

    expect(prompt).toContain(
      'Use the attached base room photo as fixed camera pose'
    );
    expect(prompt).toContain(
      '• Room brief (silent): North-facing room with generous glazing.'
    );
    expect(prompt).toContain('• Intended use: Reading nook');
    expect(prompt).toContain(
      'Favorite 1: Soft boucle chair with brass floor lamp'
    );
    expect(prompt).toContain(
      'Diversity hint for this image: slightly warmer palette; gentler contrast'
    );
    expect(prompt).toContain(
      'Generate ONE updated interior variant at 1024×682'
    );
  });

  it('uses "None" placeholders for missing values', () => {
    const prompt = buildIterationPrompt({
      roomBrief: '',
      purpose: '',
      roundGuidance: '',
      favoritesTextBlock: '',
      diversityHint: '',
    });
    expect(prompt).toContain('• Room brief (silent): None');
    expect(prompt).toContain('• Intended use: None');
    expect(prompt).toContain('• Selected favorites (as free-text, raw): None');
    expect(prompt).toContain('Diversity hint for this image: None');
  });
});

describe('buildFinalizationPrompt', () => {
  it('produces a compact finalization instruction block', () => {
    const prompt = buildFinalizationPrompt();
    expect(prompt).toContain('high-resolution re-render at 1536×1024');
    expect(prompt).toContain('Build Notes (5–7 sentences)');
  });
});

describe('runIterationBatch', () => {
  it('executes every hint and reports progress', async () => {
    const deck = ['hint-a', 'hint-b', 'hint-c'];
    const results = [];
    await runIterationBatch({
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Brief text',
      purpose: 'Lounge',
      roundGuidance: 'Keep original sofa',
      favoritesTextBlock: 'Favorite 1: Keep floor lamp',
      sampling: { temperature: 0.7, topP: 0.9, topK: 32 },
      deck,
      generateVariant: jest.fn().mockImplementation(async ({ promptText }) => ({
        imageUrl: `blob:${promptText.length}`,
        text: 'Descriptor',
        warnings: [],
      })),
      onProgress: (payload) => results.push(payload),
    });

    expect(results).toHaveLength(deck.length);
    expect(results.every((entry) => entry.ok)).toBe(true);
    const prompts = results.map((entry) => entry.result.imageUrl);
    expect(prompts).toHaveLength(3);
  });

  it('throws when generateVariant is missing', async () => {
    await expect(
      runIterationBatch({
        base64Main: 'base',
        mimeMain: 'image/jpeg',
      })
    ).rejects.toThrow('generateVariant is required');
  });

  it('surfaces errors through onProgress', async () => {
    const errors = [];
    await runIterationBatch({
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      deck: ['hint-only'],
      generateVariant: jest.fn().mockRejectedValue(new Error('boom')),
      onProgress: (payload) => errors.push(payload),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].ok).toBe(false);
    expect(errors[0].error).toEqual(new Error('boom'));
  });
});
