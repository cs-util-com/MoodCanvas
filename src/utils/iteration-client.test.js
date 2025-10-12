import {
  setIterationApiKey,
  setDefaultSampling,
  getDefaultSampling,
  generateRoomBrief,
  generateVariant,
  finalizeHiRes,
  parseFlashImageResponse,
} from './iteration-client.js';
import * as imageUtils from './image.js';

const SAMPLE_IMAGE_BASE64 = Buffer.from('fake-image-bytes').toString('base64');

beforeEach(() => {
  setIterationApiKey('test-key');
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
    if (prompt.startsWith('Write ONE short free-text paragraph')) {
      return mockResponse({
        candidates: [
          { content: { parts: [{ text: 'Auto generated description.' }] } },
        ],
      });
    }
    if (prompt.includes('ROLE: Create a concise')) {
      return mockResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Summary paragraph\n• Bullet A\n• Bullet B' }],
            },
          },
        ],
      });
    }
    return mockResponse(defaultVariantPayload());
  });
  global.URL.createObjectURL = jest.fn(() => 'blob://mock-url');
});

afterEach(() => {
  jest.resetAllMocks();
});

function mockResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function defaultVariantPayload({
  withText = true,
  mimeType = 'image/jpeg',
  data = SAMPLE_IMAGE_BASE64,
} = {}) {
  return {
    candidates: [
      {
        content: {
          parts: [
            { inlineData: { mimeType, data } },
            ...(withText ? [{ text: 'Primary descriptor paragraph.' }] : []),
          ],
        },
      },
    ],
  };
}

describe('iteration-client API helpers', () => {
  test('generateRoomBrief parses paragraph and bullets', async () => {
    const result = await generateRoomBrief({
      promptText: 'ROLE: Create a concise',
      base64Main: SAMPLE_IMAGE_BASE64,
      mimeMain: 'image/jpeg',
    });
    expect(result.paragraph).toBe('Summary paragraph');
    expect(result.bullets).toEqual(['Bullet A', 'Bullet B']);
  });

  test('generateRoomBrief throws when candidates array missing', async () => {
    // Why this test matters: Gemini may reply with empty candidates when overloaded; we should surface the empty brief error.
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => mockResponse({ candidates: [] }));
    await expect(
      generateRoomBrief({
        promptText: 'ROLE: Create a concise',
        base64Main: SAMPLE_IMAGE_BASE64,
        mimeMain: 'image/jpeg',
      })
    ).rejects.toThrow('room_brief_empty');
    global.fetch = originalFetch;
  });

  test('generateVariant returns structured image payload', async () => {
    const result = await generateVariant({
      promptText: 'Variant prompt',
      base64Main: SAMPLE_IMAGE_BASE64,
      mimeMain: 'image/jpeg',
    });
    expect(result.imageUrl).toBe('blob://mock-url');
    expect(result.text).toBe('Primary descriptor paragraph.');
    expect(result.warnings).toEqual([]);
  });

  test('generateVariant omits main inline part when base image missing', async () => {
    // Why this test matters: defensive guards keep prompts valid even if the caller lacks a normalized base image.
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url, options) => {
      void url;
      void options;
      return mockResponse(defaultVariantPayload());
    });
    await generateVariant({
      promptText: 'Variant prompt',
      base64Main: '',
      mimeMain: '',
    });
    const [, options] = global.fetch.mock.calls.pop();
    const body = JSON.parse(options.body);
    const inlineParts =
      body.contents?.[0]?.parts?.filter((part) => part.inlineData) ?? [];
    expect(inlineParts).toHaveLength(0);
    global.fetch = originalFetch;
  });

  test('finalizeHiRes forwards both main and child references', async () => {
    await finalizeHiRes({
      promptText: 'Finalize prompt',
      base64Main: SAMPLE_IMAGE_BASE64,
      mimeMain: 'image/jpeg',
      base64Child: SAMPLE_IMAGE_BASE64,
      mimeChild: 'image/jpeg',
    });
    const [, options] = global.fetch.mock.calls.pop();
    const inlineParts = JSON.parse(options.body).contents[0].parts.filter(
      (part) => part.inlineData
    );
    expect(inlineParts).toHaveLength(2); // main + child images
  });

  test('parseFlashImageResponse repairs missing descriptor text', async () => {
    const blobSpy = jest
      .spyOn(imageUtils, 'base64ToBlob')
      .mockImplementation(
        () => new Blob([Uint8Array.from([1, 2, 3])], { type: '' })
      );
    const payload = defaultVariantPayload({
      withText: false,
      mimeType: 'image/jpeg',
    });
    const result = await parseFlashImageResponse(payload);
    expect(result.warnings).toContain('auto-fixed: descriptor missing');
    expect(result.text).toBe('Auto generated description.');
    blobSpy.mockRestore();
  });

  test('parseFlashImageResponse reads inline bytes payloads', async () => {
    // Why this test matters: Gemini sometimes streams binary data via the `bytes` field instead of `data`.
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  bytes: SAMPLE_IMAGE_BASE64,
                },
              },
              { text: 'Descriptor from bytes' },
            ],
          },
        },
      ],
    };
    const result = await parseFlashImageResponse(payload);
    expect(result.imageUrl).toBe('blob://mock-url');
    expect(result.text).toBe('Descriptor from bytes');
  });

  test('generateRoomBrief throws when response is empty', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () =>
      mockResponse({ candidates: [{ content: { parts: [] } }] })
    );
    await expect(
      generateRoomBrief({
        promptText: 'ROLE: Create a concise',
        base64Main: SAMPLE_IMAGE_BASE64,
        mimeMain: 'image/jpeg',
      })
    ).rejects.toThrow('room_brief_empty');
    global.fetch = originalFetch;
  });

  test('setDefaultSampling clamps values used during generation', async () => {
    const originalFetch = global.fetch;
    const originalSampling = getDefaultSampling();
    setDefaultSampling({ temperature: 2, topP: -5, topK: 200 });
    await generateVariant({
      promptText: 'Variant prompt',
      base64Main: SAMPLE_IMAGE_BASE64,
      mimeMain: 'image/jpeg',
    });
    const [, options] = global.fetch.mock.calls.pop();
    const config = JSON.parse(options.body).generationConfig;
    expect(config).toEqual({ temperature: 1, topP: 0, topK: 64 });
    expect(getDefaultSampling()).toEqual({ temperature: 1, topP: 0, topK: 64 });
    global.fetch = originalFetch;
    setDefaultSampling(originalSampling);
  });

  test('setDefaultSampling ignores falsy input', () => {
    // Why this test matters: the settings form can submit without sampling values; we should keep prior defaults.
    const snapshot = getDefaultSampling();
    setDefaultSampling(null);
    expect(getDefaultSampling()).toEqual(snapshot);
  });

  test('setDefaultSampling falls back when numbers are NaN', () => {
    // Why this test matters: defensive parsing protects against corrupt localStorage entries.
    const original = getDefaultSampling();
    setDefaultSampling({ temperature: 'abc', topP: undefined, topK: NaN });
    expect(getDefaultSampling()).toEqual({
      temperature: 0.7,
      topP: 0.9,
      topK: 32,
    });
    setDefaultSampling(original);
  });

  test('composeParts skips falsy references', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      void url;
      return mockResponse(defaultVariantPayload());
    });
    await generateVariant({
      promptText: 'Variant prompt',
      base64Main: SAMPLE_IMAGE_BASE64,
      mimeMain: 'image/jpeg',
      references: [null, { mime: 'image/jpeg', base64: SAMPLE_IMAGE_BASE64 }],
    });
    const [, options] = global.fetch.mock.calls.pop();
    const inlineParts = JSON.parse(options.body).contents[0].parts.filter(
      (part) => part.inlineData
    );
    expect(inlineParts).toHaveLength(2); // main + single reference
    global.fetch = originalFetch;
  });
});

describe('iteration-client error handling', () => {
  test('generateVariant throws when API key missing', async () => {
    setIterationApiKey(undefined);
    await expect(
      generateVariant({
        promptText: 'Variant prompt',
        base64Main: SAMPLE_IMAGE_BASE64,
        mimeMain: 'image/jpeg',
      })
    ).rejects.toMatchObject({ code: 'missing-key' });
    setIterationApiKey('test-key');
  });

  test('gemFetch surfaces error metadata for non-OK responses', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'Bad Request', code: 400 } }),
    }));
    await expect(
      generateVariant({
        promptText: 'Variant prompt',
        base64Main: SAMPLE_IMAGE_BASE64,
        mimeMain: 'image/jpeg',
      })
    ).rejects.toMatchObject({ reason: 'Bad Request' });
    global.fetch = originalFetch;
  });

  test('safeJson fallback covers invalid JSON payloads', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      statusText: 'Server error',
      json: async () => {
        throw new Error('boom');
      },
    }));
    await expect(
      generateVariant({
        promptText: 'Variant prompt',
        base64Main: SAMPLE_IMAGE_BASE64,
        mimeMain: 'image/jpeg',
      })
    ).rejects.toHaveProperty('details.error', 'Server error');
    global.fetch = originalFetch;
  });

  test('parseFlashImageResponse throws when image part missing', async () => {
    const payload = {
      candidates: [
        {
          content: { parts: [{ text: 'Only text' }] },
        },
      ],
    };
    await expect(parseFlashImageResponse(payload)).rejects.toThrow(
      'no_image_in_response'
    );
  });

  test('parseFlashImageResponse throws when candidates array missing', async () => {
    // Why this test matters: network hiccups can produce empty payloads that should trigger retries.
    await expect(parseFlashImageResponse({})).rejects.toThrow(
      'no_image_in_response'
    );
  });

  test('parseFlashImageResponse skips inline payloads without base64 data', async () => {
    // Why this test matters: Gemini occasionally returns inline parts with empty data; we must treat them as absent.
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: '' } },
              { text: 'Ignored descriptor' },
            ],
          },
        },
      ],
    };
    await expect(parseFlashImageResponse(payload)).rejects.toThrow(
      'no_image_in_response'
    );
  });

  test('parseFlashImageResponse ignores inline payloads without mime type', async () => {
    // Why this test matters: malformed inline parts should not be mistaken for images.
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: '', data: SAMPLE_IMAGE_BASE64 } },
              { text: 'Fallback descriptor' },
            ],
          },
        },
      ],
    };
    await expect(parseFlashImageResponse(payload)).rejects.toThrow(
      'no_image_in_response'
    );
  });

  test('parseFlashImageResponse skips whitespace-only descriptor parts', async () => {
    // Why this test matters: Gemini can emit placeholder whitespace parts before real descriptors.
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: SAMPLE_IMAGE_BASE64,
                },
              },
              { text: '    ' },
              { text: 'Second descriptor takes precedence.' },
            ],
          },
        },
      ],
    };
    const result = await parseFlashImageResponse(payload);
    expect(result.text).toBe('Second descriptor takes precedence.');
  });

  test('parseFlashImageResponse surfaces auto describe failures', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url, options) => {
      void url;
      const body = JSON.parse(options.body);
      const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
      if (prompt.startsWith('Write ONE short free-text paragraph')) {
        return mockResponse({ candidates: [] });
      }
      return mockResponse(defaultVariantPayload({ withText: false }));
    });
    await expect(
      parseFlashImageResponse(defaultVariantPayload({ withText: false }))
    ).rejects.toThrow('mini_text_call_empty');
    global.fetch = originalFetch;
  });
});
