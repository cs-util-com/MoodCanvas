import {
  parseFlashImageResponse,
  generateRoomBrief,
  generateVariant,
  finalizeHiRes,
} from './gemini-iteration.js';

const originalCreateObjectURL = global.URL?.createObjectURL;
const originalFetch = global.fetch;

describe('parseFlashImageResponse', () => {
  beforeAll(() => {
    if (!global.URL) {
      global.URL = {};
    }
    global.URL.createObjectURL = jest.fn(() => 'blob://mock');
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('fetch should be mocked per test'))
    );
  });

  afterAll(() => {
    if (originalCreateObjectURL) {
      global.URL.createObjectURL = originalCreateObjectURL;
    } else {
      delete global.URL.createObjectURL;
    }
    global.fetch = originalFetch;
  });

  it('returns image and text when both present', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } },
              { text: 'A cozy interior' },
            ],
          },
        },
      ],
    };
    const result = await parseFlashImageResponse(json, { apiKey: 'test' });
    expect(result.imageUrl).toBe('blob://mock');
    expect(result.text).toBe('A cozy interior');
    expect(result.warnings).toEqual([]);
    expect(result.base64).toBe('ZmFrZQ==');
    expect(result.mimeType).toBe('image/png');
  });

  it('throws when image missing', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Only text' }],
          },
        },
      ],
    };
    await expect(
      parseFlashImageResponse(json, { apiKey: 'test' })
    ).rejects.toThrow('no_image_in_response');
  });

  it('repairs missing text via fallback call', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: 'ZmFrZQ==' } },
            ],
          },
        },
      ],
    };
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Fallback description' }],
                },
              },
            ],
          }),
      })
    );
    const result = await parseFlashImageResponse(json, {
      apiKey: 'test',
      fetchImpl,
    });
    expect(result.text).toBe('Fallback description');
    expect(result.warnings).toEqual(['auto-fixed: descriptor missing']);
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe('Gemini iteration wrappers', () => {
  const baseFetchResponse = (payload) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    });

  it('generates a room brief with paragraph and bullets', async () => {
    const fetchImpl = jest.fn(() =>
      baseFetchResponse({
        candidates: [
          {
            content: { parts: [{ text: 'Paragraph\n• First\n- Second' }] },
          },
        ],
      })
    );
    const result = await generateRoomBrief({
      apiKey: 'test',
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      fetchImpl,
    });
    expect(result.paragraph).toBe('Paragraph');
    expect(result.bullets).toEqual(['First', 'Second']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('generates a variant with image and text', async () => {
    const fetchImpl = jest.fn(() =>
      baseFetchResponse({
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } },
                { text: 'Variant text' },
              ],
            },
          },
        ],
      })
    );
    const result = await generateVariant({
      apiKey: 'test',
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [{ base64: 'cmVm', mime: 'image/png' }],
      fetchImpl,
    });
    expect(result.text).toBe('Variant text');
    expect(result.base64).toBe('ZmFrZQ==');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('skips references without base64 content', async () => {
    const fetchImpl = jest.fn(() =>
      baseFetchResponse({
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } },
                { text: 'Variant text' },
              ],
            },
          },
        ],
      })
    );
    await generateVariant({
      apiKey: 'test',
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [
        { mime: 'image/png' },
        { base64: 'cmVm', mime: 'image/png' },
      ],
      fetchImpl,
    });
    const [, request] = fetchImpl.mock.calls[0];
    const payload = JSON.parse(request.body);
    expect(payload.contents[0].parts).toHaveLength(3);
  });

  it('generates hi-res finalization with child image', async () => {
    const fetchImpl = jest.fn(() =>
      baseFetchResponse({
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: 'image/jpeg', data: 'YmFzZQ==' } },
                { text: 'Build notes' },
              ],
            },
          },
        ],
      })
    );
    const result = await finalizeHiRes({
      apiKey: 'test',
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      base64Child: 'child',
      mimeChild: 'image/jpeg',
      fetchImpl,
    });
    expect(result.text).toBe('Build notes');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws when image base64 missing', async () => {
    await expect(
      generateVariant({
        apiKey: 'test',
        promptText: 'Prompt',
        base64Main: '',
        mimeMain: 'image/jpeg',
      })
    ).rejects.toThrow('Missing base64 data');
  });

  it('bubbles HTTP errors from Gemini', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: 'fail' } }),
      })
    );
    await expect(
      generateVariant({
        apiKey: 'test',
        promptText: 'Prompt',
        base64Main: 'base',
        mimeMain: 'image/jpeg',
        fetchImpl,
      })
    ).rejects.toThrow('gemini_http_error');
  });

  it('falls back to data URLs when createObjectURL is unavailable', async () => {
    const original = global.URL.createObjectURL;
    delete global.URL.createObjectURL;
    const result = await parseFlashImageResponse(
      {
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } },
                { text: 'Text' },
              ],
            },
          },
        ],
      },
      { apiKey: 'test', fetchImpl: jest.fn(() => baseFetchResponse({})) }
    );
    expect(result.imageUrl).toBe('data:image/png;base64,ZmFrZQ==');
    global.URL.createObjectURL = original;
  });

  it('throws when room brief response is empty', async () => {
    const fetchImpl = jest.fn(() => baseFetchResponse({ candidates: [] }));
    await expect(
      generateRoomBrief({
        apiKey: 'test',
        promptText: 'Prompt',
        base64Main: 'base',
        mimeMain: 'image/jpeg',
        fetchImpl,
      })
    ).rejects.toThrow('room_brief_empty');
  });

  it('throws when fallback description returns no text', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } },
            ],
          },
        },
      ],
    };
    const fetchImpl = jest.fn(() =>
      baseFetchResponse({
        candidates: [
          {
            content: { parts: [] },
          },
        ],
      })
    );
    await expect(
      parseFlashImageResponse(json, { apiKey: 'test', fetchImpl })
    ).rejects.toThrow('mini_text_call_empty');
  });

  it('handles descriptors appearing before inline image data', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Descriptor' },
              { inlineData: { mimeType: 'image/jpeg', data: 'ZmFrZQ==' } },
            ],
          },
        },
      ],
    };
    const result = await parseFlashImageResponse(json, { apiKey: 'test' });
    expect(result.text).toBe('Descriptor');
    expect(result.base64).toBe('ZmFrZQ==');
  });
});
