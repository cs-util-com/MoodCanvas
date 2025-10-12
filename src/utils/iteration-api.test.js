import { IterationApi } from './iteration-api.js';

describe('IterationApi', () => {
  let client;
  let api;
  let originalCreateObjectURL;
  let originalFetch;
  const createResponse = (parts) => ({ candidates: [{ content: { parts } }] });

  beforeEach(() => {
    if (!global.URL) {
      global.URL = {};
    }
    originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:test');
    originalFetch = global.fetch;
    global.fetch = jest.fn(() =>
      Promise.resolve({
        blob: () => Promise.resolve(new Blob(['test'], { type: 'image/png' })),
      })
    );
    client = { generateContent: jest.fn() };
    api = new IterationApi({ client });
  });

  afterEach(() => {
    if (originalCreateObjectURL) {
      global.URL.createObjectURL = originalCreateObjectURL;
    } else {
      delete global.URL.createObjectURL;
    }
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns image and text when both are present', async () => {
    client.generateContent.mockResolvedValue(
      createResponse([
        { inlineData: { mimeType: 'image/png', data: btoa('fake') } },
        { text: 'Mood description' },
      ])
    );

    const result = await api.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/png',
    });

    expect(result.imageUrl).toBe('blob:test');
    expect(result.text).toBe('Mood description');
    expect(result.warnings).toEqual([]);
    expect(client.generateContent).toHaveBeenCalledTimes(1);
  });

  it('supports inlineData bytes field for images', async () => {
    client.generateContent.mockResolvedValue(
      createResponse([
        { inlineData: { mimeType: 'image/png', bytes: btoa('fake-bytes') } },
        { text: 'Bytes payload' },
      ])
    );

    const result = await api.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/png',
    });

    expect(result.imageUrl).toBe('blob:test');
    expect(result.text).toBe('Bytes payload');
  });

  it('falls back to default mime type when blob type is missing', async () => {
    const altFetch = jest.fn(() =>
      Promise.resolve({
        blob: () => Promise.resolve(new Blob(['alt'], { type: '' })),
      })
    );
    global.fetch = altFetch;
    client.generateContent
      .mockResolvedValueOnce(
        createResponse([
          { inlineData: { mimeType: 'image/png', data: btoa('fake') } },
        ])
      )
      .mockResolvedValueOnce(createResponse([{ text: 'Repaired text' }]));

    const result = await api.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/png',
    });

    expect(result.text).toBe('Repaired text');
    expect(altFetch).toHaveBeenCalledTimes(1);
  });

  it('auto describes blobs directly when invoked standalone', async () => {
    const altFetch = jest.fn(() =>
      Promise.resolve({
        blob: () => Promise.resolve(new Blob(['direct'], { type: '' })),
      })
    );
    global.fetch = altFetch;
    client.generateContent.mockResolvedValue(
      createResponse([{ text: 'Standalone description' }])
    );

    const text = await api.autoDescribeFromBlobUrl('blob:direct');

    expect(text).toBe('Standalone description');
    expect(altFetch).toHaveBeenCalledTimes(1);
  });

  it('auto-repairs missing text using a follow-up description call', async () => {
    client.generateContent
      .mockResolvedValueOnce(
        createResponse([
          { inlineData: { mimeType: 'image/png', data: btoa('fake') } },
        ])
      )
      .mockResolvedValueOnce(
        createResponse([{ text: 'Auto generated paragraph' }])
      );

    const result = await api.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/png',
    });

    expect(result.text).toBe('Auto generated paragraph');
    expect(result.warnings).toEqual(['auto-fixed: descriptor missing']);
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });

  it('throws when the response does not include an image', async () => {
    client.generateContent.mockResolvedValue(
      createResponse([{ text: 'Only text' }])
    );

    await expect(
      api.generateVariant({
        promptText: 'prompt',
        base64Main: 'base',
        mimeMain: 'image/png',
      })
    ).rejects.toThrow('no_image_in_response');
  });

  it('requires a client instance', () => {
    expect(() => new IterationApi({})).toThrow('client is required');
  });

  it('parses room brief paragraph and bullets', async () => {
    client.generateContent.mockResolvedValue(
      createResponse([
        { text: 'Paragraph here\n• keep envelope\n- add layers' },
      ])
    );

    const result = await api.generateRoomBrief({
      promptText: 'brief prompt',
      base64Main: 'base',
      mimeMain: 'image/png',
    });

    expect(result.paragraph).toBe('Paragraph here');
    expect(result.bullets).toEqual(['keep envelope', 'add layers']);
    expect(client.generateContent).toHaveBeenCalledTimes(1);
  });

  it('handles room brief responses missing a leading paragraph', async () => {
    client.generateContent.mockResolvedValue(
      createResponse([{ text: '\n• bullet only' }])
    );

    const result = await api.generateRoomBrief({
      promptText: 'brief prompt',
      base64Main: 'base',
      mimeMain: 'image/png',
    });

    expect(result.paragraph).toBe('• bullet only');
    expect(result.bullets).toEqual([]);
  });

  it('supports hi-res finalization requests', async () => {
    client.generateContent.mockResolvedValue(
      createResponse([
        { inlineData: { mimeType: 'image/png', data: btoa('image') } },
        { text: 'Build notes paragraph' },
      ])
    );

    const result = await api.finalizeHiRes({
      promptText: 'final prompt',
      base64Main: 'base',
      mimeMain: 'image/png',
      base64Child: 'child',
      mimeChild: 'image/png',
    });

    expect(result.text).toBe('Build notes paragraph');
    expect(result.imageUrl).toBe('blob:test');
    expect(client.generateContent).toHaveBeenCalledTimes(1);
  });

  it('throws when room brief output is empty', async () => {
    client.generateContent.mockResolvedValue(createResponse([]));

    await expect(
      api.generateRoomBrief({
        promptText: 'brief prompt',
        base64Main: 'base',
        mimeMain: 'image/png',
      })
    ).rejects.toThrow('room_brief_empty');
  });

  it('throws when auto describe returns no text', async () => {
    client.generateContent
      .mockResolvedValueOnce(
        createResponse([
          { inlineData: { mimeType: 'image/png', data: btoa('fake') } },
        ])
      )
      .mockResolvedValueOnce(createResponse([]));

    await expect(
      api.generateVariant({
        promptText: 'prompt',
        base64Main: 'base',
        mimeMain: 'image/png',
      })
    ).rejects.toThrow('mini_text_call_empty');
  });
});
