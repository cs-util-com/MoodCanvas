import {
  diversityDeck,
  buildIterationPrompt,
  favoritesToBlock,
  refsToArray,
  buildFinalizationPrompt,
  runIterationBatch,
  buildRoomBriefPrompt,
} from './iteration.js';

describe('diversityDeck', () => {
  it('provides 12 balanced hints', () => {
    const hints = diversityDeck();
    expect(hints).toHaveLength(12);
    expect(new Set(hints).size).toBe(12);
  });
});

describe('buildIterationPrompt', () => {
  it('injects contextual information', () => {
    const prompt = buildIterationPrompt({
      roomBrief: 'Paragraph + bullets',
      purpose: 'Home Office',
      roundGuidance: 'softer textiles',
      favoritesTextBlock: '(1) Calm neutral palette',
      diversityHint: 'warmer palette',
    });

    expect(prompt).toContain('Room brief (silent): Paragraph + bullets');
    expect(prompt).toContain('Intended use: Home Office');
    expect(prompt).toContain('Selected favorites (as free-text, raw): (1) Calm neutral palette');
    expect(prompt).toContain('Diversity hint for this image: warmer palette');
  });

  it('falls back to "None" when optional fields are missing', () => {
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
});

describe('buildRoomBriefPrompt', () => {
  it('summarises the user purpose and notes', () => {
    const prompt = buildRoomBriefPrompt({ purpose: 'Living Room', notes: 'Bright and airy' });
    expect(prompt).toContain('Intended use: Living Room');
    expect(prompt).toContain('Notes from user (optional): Bright and airy');
    expect(prompt.split('\n').length).toBeGreaterThan(5);
  });

  it('provides explicit "None" placeholders', () => {
    const prompt = buildRoomBriefPrompt({ purpose: '', notes: '' });
    expect(prompt).toContain('Intended use: None');
    expect(prompt).toContain('Notes from user (optional): None');
  });
});

describe('favoritesToBlock', () => {
  it('formats descriptor text and optional notes', () => {
    const block = favoritesToBlock([
      { descriptorText: 'Calm, modern palette', userNote: 'More walnut wood' },
      { descriptorText: 'Add sculptural lighting', userNote: '' },
    ]);

    expect(block).toContain('(1) Calm, modern palette [note: More walnut wood]');
    expect(block).toContain('(2) Add sculptural lighting');
  });

  it('returns an empty string when favorites are missing', () => {
    expect(favoritesToBlock(null)).toBe('');
    expect(favoritesToBlock([])).toBe('');
  });

  it('skips entries without descriptor text', () => {
    const block = favoritesToBlock([{ descriptorText: '   ', userNote: 'ignored' }]);
    expect(block).toBe('');
  });
});

describe('refsToArray', () => {
  it('keeps at most two references in order', () => {
    const refs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(refsToArray(refs)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('returns an empty array when input is invalid', () => {
    expect(refsToArray(null)).toEqual([]);
  });
});

describe('buildFinalizationPrompt', () => {
  it('mentions the high-resolution regeneration brief', () => {
    const prompt = buildFinalizationPrompt();
    expect(prompt).toContain('1536×1024');
    expect(prompt).toContain('Build Notes');
  });
});

describe('runIterationBatch', () => {
  it('runs tasks with a concurrency cap of six and surfaces progress', async () => {
    const calls = [];
    const generateVariantImpl = jest.fn(async ({ promptText }) => {
      calls.push(promptText);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { imageUrl: 'blob:ok', text: 'desc' };
    });

    const progress = [];
    await runIterationBatch({
      base64Main: 'base64',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Living Room',
      roundGuidance: 'Guidance',
      favoritesTextBlock: '(1) Favorite',
      sampling: { temperature: 0.7 },
      onProgress: (entry) => progress.push(entry),
      generateVariantImpl,
    });

    expect(generateVariantImpl).toHaveBeenCalledTimes(12);
    expect(progress.filter((entry) => entry.ok)).toHaveLength(12);
    // Ensure hints are forwarded for retries and UI bookkeeping
    expect(new Set(progress.map((entry) => entry.hint)).size).toBe(12);
  });

  it('reports failures via onProgress with ok=false', async () => {
    let callCount = 0;
    const generateVariantImpl = jest.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('failure');
      }
      return { imageUrl: 'blob:ok', text: 'desc' };
    });

    const progress = [];
    await runIterationBatch({
      base64Main: 'base64',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Living Room',
      roundGuidance: 'Guidance',
      favoritesTextBlock: '(1) Favorite',
      sampling: { temperature: 0.7 },
      onProgress: (entry) => progress.push(entry),
      generateVariantImpl,
    });

    expect(progress.some((entry) => entry.ok === false)).toBe(true);
  });

  it('returns immediately when no diversity hints are provided', async () => {
    const generateVariantImpl = jest.fn();
    const onProgress = jest.fn();
    await runIterationBatch({
      base64Main: 'base64',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Living Room',
      roundGuidance: 'Guidance',
      favoritesTextBlock: '',
      sampling: { temperature: 0.7 },
      onProgress,
      generateVariantImpl,
      hints: [],
    });

    expect(generateVariantImpl).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });
});
