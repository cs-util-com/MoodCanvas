import { runIterationBatch } from './iteration-runner.js';
import { generateVariant } from './gemini-iteration.js';

jest.mock('./gemini-iteration.js', () => ({
  generateVariant: jest.fn(),
}));

describe('runIterationBatch', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('runs tasks sequentially when pool size is 1', async () => {
    generateVariant.mockResolvedValue({
      imageUrl: 'blob://a',
      text: 'Variant A',
      warnings: [],
      base64: 'YQ==',
      mimeType: 'image/jpeg',
    });
    const events = [];
    await runIterationBatch({
      apiKey: 'test',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Bedroom',
      roundGuidance: 'Keep palette calm',
      favoritesTextBlock: '(1) Example favorite',
      deck: ['hint-one', 'hint-two'],
      poolSize: 1,
      onProgress: (event) => events.push(event),
    });
    expect(generateVariant).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(2);
    expect(events[0].ok).toBe(true);
    expect(generateVariant.mock.calls[0][0].promptText).toContain('hint-one');
    expect(generateVariant.mock.calls[1][0].promptText).toContain('hint-two');
  });

  it('reports errors without stopping the batch', async () => {
    generateVariant
      .mockResolvedValueOnce({
        imageUrl: 'blob://ok',
        text: 'OK',
        warnings: [],
        base64: 'b2s=',
        mimeType: 'image/jpeg',
      })
      .mockRejectedValueOnce(new Error('boom'));
    const events = [];
    await runIterationBatch({
      apiKey: 'test',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Bedroom',
      roundGuidance: 'Keep palette calm',
      favoritesTextBlock: '(1) Example favorite',
      deck: ['hint-one', 'hint-two'],
      poolSize: 2,
      onProgress: (event) => events.push(event),
    });
    expect(events).toHaveLength(2);
    expect(events[0].ok).toBe(true);
    expect(events[1].ok).toBe(false);
    expect(events[1].error).toBeInstanceOf(Error);
  });

  it('uses the default diversity deck when none provided', async () => {
    generateVariant.mockResolvedValue({
      imageUrl: 'blob://ok',
      text: 'OK',
      warnings: [],
      base64: 'b2s=',
      mimeType: 'image/jpeg',
    });
    await runIterationBatch({
      apiKey: 'test',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Bedroom',
      roundGuidance: 'Guidance',
      favoritesTextBlock: '',
      poolSize: 4,
      onProgress: () => {},
    });
    expect(generateVariant).toHaveBeenCalledTimes(12);
  });

  it('short-circuits when the deck is empty', async () => {
    await runIterationBatch({
      apiKey: 'test',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Bedroom',
      roundGuidance: 'Guidance',
      favoritesTextBlock: '',
      deck: [],
      poolSize: 3,
      onProgress: () => {},
    });
    expect(generateVariant).not.toHaveBeenCalled();
  });

  it('runs without an onProgress handler', async () => {
    generateVariant.mockResolvedValue({
      imageUrl: 'blob://ok',
      text: 'OK',
      warnings: [],
      base64: 'b2s=',
      mimeType: 'image/jpeg',
    });
    await runIterationBatch({
      apiKey: 'test',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      roomBrief: 'Room brief',
      purpose: 'Bedroom',
      roundGuidance: 'Guidance',
      favoritesTextBlock: '',
      deck: ['hint'],
      poolSize: 2,
    });
    expect(generateVariant).toHaveBeenCalledTimes(1);
  });
});
