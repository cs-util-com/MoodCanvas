import { parseFlashImageResponse } from './flash-image-parser.js';

describe('parseFlashImageResponse', () => {
  it('returns the first image and text part', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'ignored' },
              {
                inlineData: {
                  data: 'image-1',
                  mimeType: 'image/png',
                },
              },
              { text: 'Descriptor paragraph.' },
              {
                inlineData: {
                  data: 'image-2',
                },
              },
            ],
          },
        },
      ],
    };

    const result = parseFlashImageResponse(payload);
    expect(result.image.data).toBe('image-1');
    expect(result.image.mimeType).toBe('image/png');
    expect(result.text).toBe('Descriptor paragraph.');
  });

  it('returns empty text when descriptor part is missing', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: 'image-data',
                },
              },
            ],
          },
        },
      ],
    };

    expect(parseFlashImageResponse(payload)).toEqual({
      image: { data: 'image-data', mimeType: 'image/jpeg' },
      text: '',
    });
  });

  it('throws an error when no candidates exist', () => {
    expect(() => parseFlashImageResponse({ candidates: [] })).toThrow(/missing candidates/);
  });

  it('throws an error when no image part exists', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: 'only text' }],
          },
        },
      ],
    };

    expect(() => parseFlashImageResponse(payload)).toThrow(/missing image data/);
  });
});

