import {
  parseFlashImageResponse,
  base64ToBlob,
  blobToBase64,
  setGeminiApiKey,
  getGeminiApiKey,
  generateRoomBrief,
  generateVariant,
  finalizeHiRes,
  autoDescribeFromBlobUrl,
  blobUrlToBase64,
} from './iec-api.js';

describe('parseFlashImageResponse', () => {
  const originalCreateObjectURL = global.URL?.createObjectURL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    setGeminiApiKey('test-key');
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  });

  afterEach(() => {
    global.URL.createObjectURL = originalCreateObjectURL;
    global.fetch = originalFetch;
    setGeminiApiKey('');
    jest.restoreAllMocks();
  });

  it('extracts the first image and text pair', async () => {
    const payload = buildPayload({
      imageBase64: Buffer.from('image-data').toString('base64'),
      text: 'Variant description',
    });

    const result = await parseFlashImageResponse(payload);

    expect(result.imageUrl).toBe('blob:mock-url');
    expect(result.text).toBe('Variant description');
    expect(result.warnings).toEqual([]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('throws when the payload lacks an image', async () => {
    await expect(parseFlashImageResponse({})).rejects.toThrow('no_image_in_response');
  });

  it('repairs missing text by issuing a follow-up describe call', async () => {
    const imageData = Buffer.from('image-data').toString('base64');
    const payload = buildPayload({ imageBase64: imageData });
    const describeResponse = {
      candidates: [
        { content: { parts: [{ text: 'Auto generated description' }] } },
      ],
    };

    const blobBuffer = Buffer.from('repaired-image');
    const blob = new Blob([blobBuffer], { type: 'image/png' });
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ blob: () => Promise.resolve(blob) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(describeResponse) });

    const result = await parseFlashImageResponse(payload);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Auto generated description');
    expect(result.warnings).toEqual(['auto-fixed: descriptor missing']);
  });

  it('generates a synthetic URL when no createObjectURL is available', async () => {
    const originalGlobalCreate = global.URL?.createObjectURL;
    if (global.URL) delete global.URL.createObjectURL;

    const payload = buildPayload({
      imageBase64: Buffer.from('image-data').toString('base64'),
      text: 'Variant',
    });
    const result = await parseFlashImageResponse(payload);
    expect(result.imageUrl).toMatch(/^blob:/);

    if (global.URL) {
      global.URL.createObjectURL = originalGlobalCreate;
    }
  });
});

describe('base64 conversions', () => {
  it('round trips data between base64 and blob', async () => {
    const content = 'hello world';
    const base64 = Buffer.from(content, 'utf8').toString('base64');
    const blob = base64ToBlob(base64, 'text/plain');

    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe(content.length);

    const roundTrip = await blobToBase64(blob);
    expect(roundTrip).toBe(base64);
  });

  it('validates base64 inputs', () => {
    expect(() => base64ToBlob(123, 'text/plain')).toThrow(TypeError);
  });

  it('returns empty blobs when given an empty base64 string', () => {
    const blob = base64ToBlob('', 'image/png');
    expect(blob.size).toBe(0);
    expect(blob.type).toBe('image/png');
  });

  it('falls back to FileReader when arrayBuffer is unavailable', async () => {
    const original = Blob.prototype.arrayBuffer;
    delete Blob.prototype.arrayBuffer;
    try {
      const content = 'fallback';
      const blob = new Blob([content], { type: 'text/plain' });
      const base64 = await blobToBase64(blob);
      expect(base64).toBe(Buffer.from(content).toString('base64'));
    } finally {
      Blob.prototype.arrayBuffer = original;
    }
  });
});

describe('generation helpers', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    setGeminiApiKey('test-key');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setGeminiApiKey('');
  });

  it('parses room brief responses into paragraph and bullets', async () => {
    const payload = {
      candidates: [
        { content: { parts: [{ text: 'Paragraph text\n• Bullet one\n- Bullet two' }] } },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });

    const result = await generateRoomBrief({
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    });

    expect(result.paragraph).toBe('Paragraph text');
    expect(result.bullets).toEqual(['Bullet one', 'Bullet two']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('builds request bodies with references for variants', async () => {
    const imageData = Buffer.from('image').toString('base64');
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: imageData } },
              { text: 'Descriptor' },
            ],
          },
        },
      ],
    };
    global.URL.createObjectURL = jest.fn(() => 'blob:variant');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });

    const result = await generateVariant({
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      references: [{ mime: 'image/png', base64: 'ref' }],
    });

    expect(result.text).toBe('Descriptor');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.contents[0].parts).toHaveLength(3);
  });

  it('surfaces errors from the Gemini API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'bad request' } }),
    });

    await expect(generateRoomBrief({
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    })).rejects.toThrow('bad request');
  });

  it('requires an API key before making calls', async () => {
    setGeminiApiKey('');
    await expect(generateVariant({
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    })).rejects.toThrow('Gemini API key missing');
  });

  it('uses status text when the error payload is malformed', async () => {
    setGeminiApiKey('test-key');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server error',
      json: () => Promise.reject(new Error('boom')),
    });

    await expect(generateVariant({
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    })).rejects.toThrow('Server error');
  });

  it('sends child images during finalization calls', async () => {
    const imageData = Buffer.from('image').toString('base64');
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'image/png', data: imageData } },
              { text: 'Build notes' },
            ],
          },
        },
      ],
    };
    global.URL.createObjectURL = jest.fn(() => 'blob:final');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });

    const result = await finalizeHiRes({
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      base64Child: 'child',
      mimeChild: 'image/jpeg',
      references: [{ mime: 'image/png', base64: 'ref1' }, { mime: 'image/jpeg', base64: 'ref2' }],
    });

    expect(result.text).toBe('Build notes');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.contents[0].parts).toHaveLength(5);
  });

  it('bubbles room brief empties as errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ candidates: [{ content: { parts: [] } }] }) });

    await expect(generateRoomBrief({
      promptText: 'Prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    })).rejects.toThrow('room_brief_empty');
  });

  it('exposes the stored API key', () => {
    setGeminiApiKey('  xyz  ');
    expect(getGeminiApiKey()).toBe('xyz');
  });

  it('propagates errors when auto describe returns no text', async () => {
    const blob = new Blob([Buffer.from('data')], { type: 'image/png' });
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ blob: () => Promise.resolve(blob) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ candidates: [{ content: { parts: [] } }] }) });

    await expect(autoDescribeFromBlobUrl('blob:missing')).rejects.toThrow('mini_text_call_empty');
  });

  it('converts blob URLs back to base64 data', async () => {
    const content = 'hello';
    const expected = Buffer.from(content).toString('base64');
    const blob = new Blob([content], { type: 'text/plain' });
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) });

    const base64 = await blobUrlToBase64('blob:url');
    expect(base64).toBe(expected);
  });
});

function buildPayload({ imageBase64, text = '' }) {
  return {
    candidates: [
      {
        content: {
          parts: [
            { inlineData: { mimeType: 'image/png', data: imageBase64 } },
            ...(text ? [{ text }] : []),
          ],
        },
      },
    ],
  };
}
