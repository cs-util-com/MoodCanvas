import { GeminiClient, parseFlashImageResponse } from './gemini-client.js';

describe('GeminiClient', () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  });

  it('binds fetchImpl to the global context', async () => {
    expect.assertions(3);

    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'imgdata' } },
              { text: 'Descriptor' },
            ],
          },
        },
      ],
    };

    let capturedThis;
    const fetchResponse = { ok: true, json: jest.fn().mockResolvedValue(payload) };
    const fetchImpl = jest.fn(function (url) {
      capturedThis = this;
      expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent');
      return Promise.resolve(fetchResponse);
    });

    const client = new GeminiClient({ apiKey: 'test-key', fetchImpl });
    await client.generateVariant({ promptText: 'prompt', base64Main: 'base', mimeMain: 'image/jpeg' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(capturedThis).toBe(globalThis);
  });

  it('falls back to describeImage when the response lacks text', async () => {
    expect.assertions(2);

    const imagePayload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'abc' } },
            ],
          },
        },
      ],
    };

    const textPayload = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Auto description' },
            ],
          },
        },
      ],
    };

    const fetchResponseImage = { ok: true, json: jest.fn().mockResolvedValue(imagePayload) };
    const fetchResponseText = { ok: true, json: jest.fn().mockResolvedValue(textPayload) };
    const fetchImpl = jest.fn()
      .mockImplementationOnce(() => Promise.resolve(fetchResponseImage))
      .mockImplementationOnce(() => Promise.resolve(fetchResponseText));

    const client = new GeminiClient({ apiKey: 'test-key', fetchImpl });
    const result = await client.generateVariant({ promptText: 'prompt', base64Main: 'base', mimeMain: 'image/jpeg' });

    expect(result.text).toBe('Auto description');
    expect(result.warnings).toContain('auto-fixed: descriptor missing');
  });

  it('parses room brief responses into paragraph and bullets', async () => {
    expect.assertions(4);

    const roomBriefPayload = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Paragraph line\n• Bullet one\n• Bullet two' },
            ],
          },
        },
      ],
    };

    const fetchResponse = { ok: true, json: jest.fn().mockResolvedValue(roomBriefPayload) };
    const fetchImpl = jest.fn(() => Promise.resolve(fetchResponse));

    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    const result = await client.generateRoomBrief({ promptText: 'prompt', base64Main: 'base64', mimeMain: 'image/jpeg' });

    expect(result.paragraph).toBe('Paragraph line');
    expect(result.bullets).toEqual(['Bullet one', 'Bullet two']);
    expect(result.raw).toContain('Paragraph line');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('throws when describeImage is invoked without base64 data', async () => {
    const client = new GeminiClient({ apiKey: 'key', fetchImpl: jest.fn() });
    await expect(client.describeImage({ base64Image: '' })).rejects.toThrow('base64Image is required');
  });

  it('finalizes hi-res renders and surfaces build notes', async () => {
    expect.assertions(3);

    const imagePayload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: 'img' } },
              { text: 'Build notes paragraph' },
            ],
          },
        },
      ],
    };

    const fetchResponse = { ok: true, json: jest.fn().mockResolvedValue(imagePayload) };
    const fetchImpl = jest.fn(() => Promise.resolve(fetchResponse));

    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    const result = await client.finalizeHiRes({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      base64Child: 'child',
      mimeChild: 'image/jpeg',
    });

    expect(result.imageUrl).toBe('blob:mock-url');
    expect(result.text).toBe('Build notes paragraph');
    expect(result.warnings).toEqual([]);
  });

  it('throws informative errors for missing inputs', async () => {
    const client = new GeminiClient({ apiKey: 'key', fetchImpl: jest.fn() });
    await expect(client.generateRoomBrief({ promptText: 'prompt' })).rejects.toThrow(/base64Main is required/);
    await expect(client.finalizeHiRes({ promptText: 'prompt', base64Main: 'base' })).rejects.toThrow(/base64Child is required/);
  });

  it('builds image requests with at most two references containing base64 data', async () => {
    expect.assertions(2);
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: 'img' } },
              { text: 'Descriptor' },
            ],
          },
        },
      ],
    };
    const fetchResponse = { ok: true, json: jest.fn().mockResolvedValue(payload) };
    const fetchImpl = jest.fn((url, options) => {
      const body = JSON.parse(options.body);
      const parts = body.contents[0].parts;
      expect(parts).toHaveLength(3);
      return Promise.resolve(fetchResponse);
    });
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    await client.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      references: [
        { base64: 'ref-a', mimeType: 'image/png' },
        { base64: null, mimeType: 'image/png' },
        { base64: 'ref-b', mimeType: 'image/jpeg' },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('supports swapping API keys through the setter', () => {
    const client = new GeminiClient({ fetchImpl: jest.fn() });
    client.setApiKey('new-key');
    expect(client.apiKey).toBe('new-key');
  });

  it('throws when the room brief response is empty', async () => {
    const payload = { candidates: [{ content: { parts: [] } }] };
    const fetchResponse = { ok: true, json: jest.fn().mockResolvedValue(payload) };
    const fetchImpl = jest.fn(() => Promise.resolve(fetchResponse));
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    await expect(client.generateRoomBrief({ promptText: 'prompt', base64Main: 'base' })).rejects.toThrow('room_brief_empty');
  });

  it('falls back to describeImage during finalizeHiRes when build notes are missing', async () => {
    expect.assertions(2);
    const imagePayload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: 'img' } },
            ],
          },
        },
      ],
    };
    const textPayload = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Recovered notes' },
            ],
          },
        },
      ],
    };
    const fetchResponseImage = { ok: true, json: jest.fn().mockResolvedValue(imagePayload) };
    const fetchResponseText = { ok: true, json: jest.fn().mockResolvedValue(textPayload) };
    const fetchImpl = jest.fn()
      .mockImplementationOnce(() => Promise.resolve(fetchResponseImage))
      .mockImplementationOnce(() => Promise.resolve(fetchResponseText));
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    const result = await client.finalizeHiRes({ promptText: 'prompt', base64Main: 'base', base64Child: 'child' });
    expect(result.text).toBe('Recovered notes');
    expect(result.warnings).toContain('auto-fixed: descriptor missing');
  });

  it('injects reference parts during finalizeHiRes calls', async () => {
    expect.assertions(2);
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: 'img' } },
              { text: 'Notes' },
            ],
          },
        },
      ],
    };
    const fetchResponse = { ok: true, json: jest.fn().mockResolvedValue(payload) };
    const fetchImpl = jest.fn((url, options) => {
      const body = JSON.parse(options.body);
      const parts = body.contents[0].parts;
      expect(parts).toHaveLength(4);
      return Promise.resolve(fetchResponse);
    });
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    const result = await client.finalizeHiRes({
      promptText: 'prompt',
      base64Main: 'base',
      base64Child: 'child',
      references: [{ base64: 'ref', mimeType: 'image/png' }],
    });
    expect(result.text).toBe('Notes');
  });

  it('raises Gemini errors when the network response is not ok', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({ error: { message: 'fail' } }),
    }));
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    await expect(client.generateVariant({ promptText: 'prompt', base64Main: 'base' })).rejects.toThrow('Gemini request failed');
  });

  it('falls back to the global fetch implementation when none is supplied', async () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'img' } },
              { text: 'Descriptor' },
            ],
          },
        },
      ],
    };
    const previousFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue(payload) }));
    try {
      const client = new GeminiClient();
      client.setApiKey('key');
      const result = await client.generateVariant({ promptText: 'prompt', base64Main: 'base' });
      expect(result.text).toBe('Descriptor');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('throws when describeImage cannot recover text', async () => {
    const emptyPayload = { candidates: [{ content: { parts: [] } }] };
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue(emptyPayload) }));
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    await expect(client.describeImage({ base64Image: 'img' })).rejects.toThrow('mini_text_call_empty');
  });

  it('validates prompt and base64 inputs before generating variants', async () => {
    const client = new GeminiClient({ apiKey: 'key', fetchImpl: jest.fn() });
    await expect(client.generateVariant({ promptText: '', base64Main: 'base' })).rejects.toThrow(/promptText is required/);
    await expect(client.generateVariant({ promptText: 'p', base64Main: '' })).rejects.toThrow(/base64Main is required/);
  });

  it('requires an API key before issuing image calls', async () => {
    const client = new GeminiClient({ fetchImpl: jest.fn() });
    await expect(client.generateVariant({ promptText: 'p', base64Main: 'base' })).rejects.toThrow('Gemini API key missing');
  });
});

describe('parseFlashImageResponse', () => {
  it('throws when no image data is returned', () => {
    expect(() => parseFlashImageResponse({ candidates: [{}] })).toThrow('no_image_in_response');
  });

  it('throws when no candidate is provided', () => {
    expect(() => parseFlashImageResponse({})).toThrow('no_candidate');
  });

  it('extracts the first image and text from the payload', () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'image-data' } },
              { text: 'Primary text' },
              { text: 'Ignored text' },
            ],
          },
        },
      ],
    };

    const parsed = parseFlashImageResponse(json);
    expect(parsed.imageBase64).toBe('image-data');
    expect(parsed.imageMimeType).toBe('image/png');
    expect(parsed.text).toBe('Primary text');
  });

  it('skips non-image parts until an inline image appears', () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Descriptor first' },
              { inlineData: { mimeType: 'image/png', data: 'image-data' } },
            ],
          },
        },
      ],
    };
    const parsed = parseFlashImageResponse(json);
    expect(parsed.text).toBe('Descriptor first');
    expect(parsed.imageBase64).toBe('image-data');
  });

  it('ignores additional inline images after the first one', () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'first-image' } },
              { inlineData: { mimeType: 'image/png', data: 'second-image' } },
              { text: 'Final descriptor' },
            ],
          },
        },
      ],
    };
    const parsed = parseFlashImageResponse(json);
    expect(parsed.imageBase64).toBe('first-image');
    expect(parsed.text).toBe('Final descriptor');
  });
});
