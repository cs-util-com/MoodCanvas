import { GeminiClient } from './gemini-client.js';

describe('GeminiClient', () => {
  it('calls fetchImpl with the global context to avoid illegal invocation', async () => {
    expect.assertions(3);

    const mockPayload = {
      candidates: [
        {
          content: {
            parts: [
              {
                jsonValue: {
                  usage_candidates: [],
                  photo_findings: {},
                  palette_60_30_10: {},
                  constraints: {},
                  quick_wins: [],
                  styles_top10: [],
                  smart_mixed_axes: {
                    axisA: { label: 'A', description: 'axis A' },
                    axisB: { label: 'B', description: 'axis B' },
                  },
                  negative_prompts: [],
                  safety_checks: [],
                  render_gallery: [],
                },
              },
            ],
          },
        },
      ],
    };

    let capturedThis;
    const fetchResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue(mockPayload),
    };

    const fetchImpl = jest.fn(function (url, options) {
      capturedThis = this;
      expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      return Promise.resolve(fetchResponse);
    });

    const client = new GeminiClient({ apiKey: 'test-key', fetchImpl });

    await client.analyzeRoom({ imageBase64: 'data', prompt: 'prompt' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(capturedThis).toBe(globalThis);
  });
});
