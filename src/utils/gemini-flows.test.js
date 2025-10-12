import { GeminiFlows, parseFlashImageResponse } from './gemini-flows.js';

const originalCreateObjectURL = global.URL.createObjectURL;

beforeEach(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:test');
});

afterEach(() => {
  global.URL.createObjectURL = originalCreateObjectURL;
});

describe('parseFlashImageResponse', () => {
  it('returns image URL and descriptor when both are present', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: Buffer.from('image-bytes').toString('base64'),
                },
              },
              { text: 'Cozy evening lounge description' },
            ],
          },
        },
      ],
    };

    const result = await parseFlashImageResponse(json, {
      autoDescribe: jest.fn(),
    });

    expect(result.imageUrl).toBe('blob:test');
    expect(result.text).toBe('Cozy evening lounge description');
    expect(result.warnings).toEqual([]);
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  it('throws an error when the image is missing', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Only descriptor' }],
          },
        },
      ],
    };

    await expect(
      parseFlashImageResponse(json, { autoDescribe: jest.fn() })
    ).rejects.toThrow('no_image_in_response');
  });

  it('invokes autoDescribe when the descriptor is missing', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: Buffer.from('image-bytes').toString('base64'),
                },
              },
            ],
          },
        },
      ],
    };
    const autoDescribe = jest.fn().mockResolvedValue('Repaired descriptor');

    const result = await parseFlashImageResponse(json, { autoDescribe });

    expect(autoDescribe).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('Repaired descriptor');
    expect(result.warnings).toEqual(['auto-fixed: descriptor missing']);
  });

  it('throws when autoDescribe handler is missing', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: Buffer.from('image-bytes').toString('base64'),
                },
              },
            ],
          },
        },
      ],
    };

    await expect(parseFlashImageResponse(json)).rejects.toThrow(
      'auto_describe_missing_handler'
    );
  });

  it('accepts inlineData bytes payloads', async () => {
    const json = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  bytes: Buffer.from('bytes-data').toString('base64'),
                },
              },
              { text: 'Descriptor from bytes' },
            ],
          },
        },
      ],
    };

    const result = await parseFlashImageResponse(json, {
      autoDescribe: jest.fn(),
    });

    expect(result.imageUrl).toBe('blob:test');
    expect(result.text).toBe('Descriptor from bytes');
  });
});

describe('GeminiFlows', () => {
  const makeResponse = (payload) => ({
    ok: true,
    json: async () => payload,
  });

  it('generates and parses room brief responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      makeResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Paragraph line\n• bullet 1\n• bullet 2' }],
            },
          },
        ],
      })
    );
    const flows = new GeminiFlows({ apiKey: 'test-key', fetchImpl });
    const result = await flows.generateRoomBrief({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('gemini-2.5-flash:generateContent'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.paragraph).toBe('Paragraph line');
    expect(result.bullets).toEqual(['bullet 1', 'bullet 2']);
  });

  it('throws when room brief text is empty', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      makeResponse({
        candidates: [{ content: { parts: [{ text: '   ' }] } }],
      })
    );
    const flows = new GeminiFlows({ apiKey: 'test-key', fetchImpl });
    await expect(
      flows.generateRoomBrief({
        promptText: 'prompt',
        base64Main: 'base',
        mimeMain: 'image/jpeg',
      })
    ).rejects.toThrow('room_brief_empty');
  });

  it('returns image and descriptor for variants', async () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: Buffer.from('image-bytes').toString('base64'),
                },
              },
              { text: 'Descriptor text' },
            ],
          },
        },
      ],
    };
    const fetchImpl = jest.fn().mockResolvedValue(makeResponse(payload));
    const flows = new GeminiFlows({ apiKey: 'test-key', fetchImpl });
    const result = await flows.generateVariant({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('gemini-2.5-flash-image:generateContent'),
      expect.any(Object)
    );
    expect(result.imageUrl).toBe('blob:test');
    expect(result.text).toBe('Descriptor text');
  });

  it('supports hi-res finalization with child image', async () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: Buffer.from('hires-bytes').toString('base64'),
                },
              },
              { text: 'Build notes paragraph' },
            ],
          },
        },
      ],
    };
    const fetchImpl = jest.fn().mockResolvedValue(makeResponse(payload));
    const flows = new GeminiFlows({ apiKey: 'test-key', fetchImpl });
    const result = await flows.finalizeHiRes({
      promptText: 'prompt',
      base64Main: 'base',
      mimeMain: 'image/jpeg',
      base64Child: 'child',
      mimeChild: 'image/png',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('gemini-2.5-flash-image:generateContent'),
      expect.any(Object)
    );
    expect(result.imageUrl).toBe('blob:test');
    expect(result.text).toBe('Build notes paragraph');
  });

  it('requires an API key before image calls', async () => {
    const flows = new GeminiFlows({ fetchImpl: jest.fn() });
    await expect(
      flows.generateVariant({
        promptText: 'prompt',
        base64Main: 'base',
        mimeMain: 'image/jpeg',
      })
    ).rejects.toHaveProperty('message', 'Gemini API key missing');
  });

  it('surfaces errors from auto-describe fallback', async () => {
    const imagePayload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: Buffer.from('image-bytes').toString('base64'),
                },
              },
            ],
          },
        },
      ],
    };
    const emptyTextPayload = {
      candidates: [
        {
          content: {
            parts: [],
          },
        },
      ],
    };
    let call = 0;
    const fetchImpl = jest.fn().mockImplementation(() => {
      const payload = call === 0 ? imagePayload : emptyTextPayload;
      call += 1;
      return makeResponse(payload);
    });
    const flows = new GeminiFlows({ apiKey: 'test-key', fetchImpl });
    await expect(
      flows.generateVariant({
        promptText: 'prompt',
        base64Main: 'base',
        mimeMain: 'image/jpeg',
      })
    ).rejects.toThrow('mini_text_call_empty');
  });
});
