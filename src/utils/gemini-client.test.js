import { GeminiIECClient, DEFAULT_SAMPLING } from './gemini-client.js';

const SAMPLE_IMAGE = 'YmFzZTY0';

function createResponse({ image = true, text = 'hello world' }) {
  const parts = [];
  if (image) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: SAMPLE_IMAGE } });
  }
  if (text !== null) {
    parts.push({ text });
  }
  return { candidates: [{ content: { parts } }] };
}

describe('GeminiIECClient', () => {
  let originalCreateObjectURL;

  beforeAll(() => {
    originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:url');
  });

  beforeEach(() => {
    URL.createObjectURL.mockClear();
  });

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('enforces API key presence', async () => {
    const client = new GeminiIECClient({ fetchImpl: jest.fn() });
    await expect(
      client.generateRoomBrief({ promptText: 'prompt', base64Main: 'a', mimeMain: 'image/jpeg' })
    ).rejects.toThrow('Gemini API key missing');
  });

  it('uses default fetch implementation when no override is provided', () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn();
    try {
      const client = new GeminiIECClient();
      client.setApiKey(' key ');
      expect(client.apiKey).toBe('key');
      client.setApiKey(null);
      expect(client.apiKey).toBe('');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('builds a room brief structure from text response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [{ text: 'Paragraph\n• Bullet A\n- Bullet B' }],
              },
            },
          ],
        }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    const result = await client.generateRoomBrief({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      sampling: DEFAULT_SAMPLING,
    });
    expect(result).toEqual({
      paragraph: 'Paragraph',
      bullets: ['Bullet A', 'Bullet B'],
      raw: 'Paragraph\n• Bullet A\n- Bullet B',
    });
  });

  it('throws when the room brief response is empty', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    await expect(
      client.generateRoomBrief({ promptText: 'prompt', base64Main: 'base', mimeMain: 'image/jpeg' })
    ).rejects.toThrow('room_brief_empty');
  });

  it('throws when room brief response contains no candidates', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    await expect(
      client.generateRoomBrief({ promptText: 'prompt', base64Main: 'base', mimeMain: 'image/jpeg' })
    ).rejects.toThrow('room_brief_empty');
  });

  it('parses iteration variant responses without repair', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/jpeg', data: SAMPLE_IMAGE } },
                  { text: 'Variant description' },
                ],
              },
            },
          ],
        }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    const result = await client.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [],
      sampling: DEFAULT_SAMPLING,
    });
    expect(result.text).toBe('Variant description');
    expect(result.imageUrl).toBe('blob:url');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('passes references and child image when finalizing hi-res', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/png', data: SAMPLE_IMAGE } },
                  { text: 'Build notes' },
                ],
              },
            },
          ],
        }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    const result = await client.finalizeHiRes({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      base64Child: 'child',
      mimeChild: 'image/jpeg',
      references: [{ mime: 'image/png', base64: 'ref' }],
      sampling: DEFAULT_SAMPLING,
    });
    expect(result.text).toBe('Build notes');
    expect(result.imageUrl).toBe('blob:url');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('supports inline data delivered via bytes field', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/jpeg', bytes: SAMPLE_IMAGE } },
                  { text: 'Descriptor' },
                ],
              },
            },
          ],
        }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    const result = await client.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    });
    expect(result.text).toBe('Descriptor');
    expect(result.imageUrl).toBe('blob:url');
  });

  it('uses default arguments for references and sampling when omitted', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/jpeg', data: SAMPLE_IMAGE } },
                  { text: 'Descriptor' },
                ],
              },
            },
          ],
        }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    await client.generateVariant({ promptText: 'prompt', base64Main: 'base', mimeMain: 'image/jpeg' });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('finalizes hi-res using default references and sampling', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/jpeg', data: SAMPLE_IMAGE } },
                  { text: 'Build notes' },
                ],
              },
            },
          ],
        }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    await client.finalizeHiRes({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      base64Child: 'child',
      mimeChild: 'image/jpeg',
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('throws when the response does not contain an image', async () => {
    const client = new GeminiIECClient({ fetchImpl: jest.fn() });
    await expect(client.parseFlashImageResponse(createResponse({ image: false }))).rejects.toThrow(
      'no_image_in_response'
    );
  });

  it('throws when the payload has no candidates array', async () => {
    const client = new GeminiIECClient({ fetchImpl: jest.fn() });
    await expect(client.parseFlashImageResponse({})).rejects.toThrow('no_image_in_response');
  });

  it('returns image and text when both are available', async () => {
    const client = new GeminiIECClient({ fetchImpl: jest.fn() });
    const result = await client.parseFlashImageResponse(createResponse({ image: true, text: 'A' }));
    expect(result).toEqual({ imageUrl: 'blob:url', text: 'A', warnings: [] });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('auto-fills text when missing by calling fetch + text model', async () => {
    const blob = new Blob(['binary'], { type: 'image/jpeg' });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(blob) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: 'auto generated description' }],
                },
              },
            ],
          }),
      });

    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');

    const response = createResponse({ image: true, text: '' });
    const resultPromise = client.parseFlashImageResponse(response);
    await expect(resultPromise).resolves.toEqual({
      imageUrl: 'blob:url',
      text: 'auto generated description',
      warnings: ['auto-fixed: descriptor missing'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, apiCall] = fetchImpl.mock.calls;
    expect(apiCall[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    const body = JSON.parse(apiCall[1].body);
    expect(body.generationConfig.temperature).toBe(DEFAULT_SAMPLING.temperature);
  });

  it('uses a default mime type when the blob is missing type information', async () => {
    const blob = new Blob(['binary']);
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(blob) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: 'auto generated description' }],
                },
              },
            ],
          }),
      });

    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');

    await client.parseFlashImageResponse(createResponse({ image: true, text: '' }));
    const [, apiCall] = fetchImpl.mock.calls;
    const body = JSON.parse(apiCall[1].body);
    const inlineData = body.contents[0].parts[1].inlineData;
    expect(inlineData.mimeType).toBe('image/jpeg');
  });

  it('skips inline data branch when encountering text-only parts first', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'A' },
                  { inlineData: { mimeType: 'image/jpeg', data: SAMPLE_IMAGE } },
                ],
              },
            },
          ],
        }),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    const result = await client.parseFlashImageResponse(createResponse({ image: true, text: 'A' }));
    expect(result.imageUrl).toBe('blob:url');
  });

  it('handles inline data without bytes or data gracefully', async () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg' } },
              { text: 'Descriptor' },
            ],
          },
        },
      ],
    };
    const client = new GeminiIECClient({ fetchImpl: jest.fn() });
    const result = await client.parseFlashImageResponse(response);
    expect(result.imageUrl).toBe('blob:url');
    expect(result.text).toBe('Descriptor');
  });

  it('throws when text repair returns an empty response', async () => {
    const blob = new Blob(['binary'], { type: 'image/jpeg' });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(blob) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [] } }] }),
      });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    await expect(client.parseFlashImageResponse(createResponse({ image: true, text: '' }))).rejects.toThrow(
      'mini_text_call_empty'
    );
  });

  it('bubbles Gemini HTTP errors with context', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('denied'),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    await expect(
      client.generateVariant({
        promptText: 'prompt',
        base64Main: 'base',
        mimeMain: 'image/jpeg',
      })
    ).rejects.toMatchObject({ message: 'Gemini request failed', status: 403, reason: 'denied' });
  });

  it('falls back to status text when response.text rejects', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'server error',
      text: () => Promise.reject(new Error('boom')),
    });
    const client = new GeminiIECClient({ fetchImpl });
    client.setApiKey('key');
    await expect(
      client.generateVariant({ promptText: 'prompt', base64Main: 'base', mimeMain: 'image/jpeg' })
    ).rejects.toMatchObject({ reason: 'server error' });
  });
});
