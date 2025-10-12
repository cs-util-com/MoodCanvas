import { GeminiClient } from './gemini-client.js';

describe('GeminiClient', () => {
  it('calls fetchImpl with the global context to avoid illegal invocation', async () => {
    expect.assertions(3);

    let capturedThis;
    const fetchResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    };

    const fetchImpl = jest.fn(function (url) {
      capturedThis = this;
      expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      return Promise.resolve(fetchResponse);
    });

    const client = new GeminiClient({ apiKey: 'test-key', fetchImpl });

    await client.callFlash({ parts: [{ text: 'Hello' }] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(capturedThis).toBe(globalThis);
  });

  it('sends flash-image requests with merged generation config and inline data', async () => {
    expect.assertions(4);

    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });

    await client.callFlashImage({
      parts: [
        { text: 'Prompt' },
        { inlineData: { mimeType: 'image/jpeg', data: 'AAA' } },
      ],
      generationConfig: { temperature: 0.5 },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, options] = fetchImpl.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.generationConfig.temperature).toBe(0.5);
    expect(payload.generationConfig.topP).toBe(0.9);
    expect(payload.contents[0].parts).toHaveLength(2);
  });

  it('throws when parts are missing', async () => {
    const client = new GeminiClient({ apiKey: 'key', fetchImpl: jest.fn() });
    await expect(client.callFlash({})).rejects.toThrow(/parts/);
  });

  it('throws when no API key is configured', async () => {
    const client = new GeminiClient({ fetchImpl: jest.fn() });
    await expect(
      client.callFlash({
        parts: [{ text: 'Hello' }],
      })
    ).rejects.toHaveProperty('code', 'missing-key');
  });

  it('merges response mime type and schema into the generation config', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });
    await client.callFlash({
      parts: [{ text: 'Hello' }],
      responseMimeType: 'application/json',
      responseSchema: { type: 'object' },
    });
    const [, options] = fetchImpl.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseSchema).toEqual({ type: 'object' });
  });

  it('throws a detailed error when the API responds with an error payload', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'bad request', code: 400 } }),
      })
    );
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });

    await expect(
      client.callFlash({ parts: [{ text: 'Hi' }] })
    ).rejects.toMatchObject({ status: 400, reason: 'bad request' });
  });

  it('falls back to statusText when error payload cannot be parsed', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Server error',
        json: () => {
          throw new Error('bad json');
        },
      })
    );
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });

    await expect(client.callFlash({ parts: [{ text: 'Hi' }] })).rejects.toMatchObject({ reason: undefined, status: 500 });
  });

  it('merges abort signals so cancelling either aborts the request', async () => {
    expect.assertions(2);
    const abortController = new AbortController();
    let rejectFetch;
    const fetchImpl = jest.fn((url, options) => {
      options.signal.addEventListener('abort', (event) => {
        rejectFetch(event.target.reason);
      });
      return new Promise((_, reject) => {
        rejectFetch = reject;
      });
    });
    const client = new GeminiClient({ apiKey: 'key', fetchImpl });

    const promise = client.callFlash({ parts: [{ text: 'Hi' }], signal: abortController.signal });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    abortController.abort(new Error('cancelled'));
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it('updates the API key via setApiKey', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
    const client = new GeminiClient({ apiKey: 'initial', fetchImpl });
    client.setApiKey('updated');
    await client.callFlash({ parts: [{ text: 'Ping' }] });
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers['x-goog-api-key']).toBe('updated');
  });
});
