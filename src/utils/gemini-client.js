/* istanbul ignore file */
import { ANALYSIS_SCHEMA } from '../constants/analysis-schema.js';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const ANALYSIS_MODEL = 'models/gemini-2.5-flash:generateContent';
const RENDER_MODEL = 'models/gemini-2.5-flash-image:generateContent';

export class GeminiClient {
  constructor({ apiKey = '', fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  async analyzeRoom({
    imageBase64,
    prompt,
    signal,
    timeoutMs = 45_000,
    schema = ANALYSIS_SCHEMA,
  }) {
    if (!imageBase64) {
      throw new Error('imageBase64 is required for analysis');
    }

    const response = await this.#request({
      model: ANALYSIS_MODEL,
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      },
      timeoutMs,
      signal,
    });

    const json = await response.json();
    return parseAnalysisPayload(json);
  }

  async generateRenders({
    prompt,
    imageBase64,
    count = 1,
    signal,
    timeoutMs = 120_000,
  }) {
    if (!imageBase64) {
      throw new Error('imageBase64 is required for renders');
    }
    if (!prompt) {
      throw new Error('prompt is required for renders');
    }

    const jobs = Array.from({ length: count }, (_, index) =>
      this.#request({
        model: RENDER_MODEL,
        timeoutMs,
        signal,
        body: {
          contents: [
            {
              role: 'user',
              parts: [
                { text: promptWithSeed(prompt, index) },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
        },
      })
        .then((response) => response.json())
        .then((payload) => parseRenderPayload(payload))
    );

    return Promise.all(jobs);
  }

  async #request({ model, body, timeoutMs, signal }) {
    this.#ensureKey();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

    const mergedSignal = signal
      ? mergeAbortSignals(signal, controller.signal)
      : controller.signal;

    try {
      const response = await this.fetchImpl(`${API_ROOT}/${model}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: mergedSignal,
      });

      if (!response.ok) {
        throw buildGeminiError(await safeJson(response), 'Gemini request failed', response.status);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  #ensureKey() {
    if (!this.apiKey) {
      throw Object.assign(new Error('Gemini API key missing'), { code: 'missing-key' });
    }
  }
}

function mergeAbortSignals(a, b) {
  if (!a) return b;
  if (!b) return a;
  const controller = new AbortController();
  const abort = (event) => controller.abort(event?.target?.reason ?? a.reason ?? b.reason);
  a.addEventListener('abort', abort);
  b.addEventListener('abort', abort);
  return controller.signal;
}

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return { error: response.statusText };
    }
  }

  function parseAnalysisPayload(json) {
    const candidate = json.candidates?.[0];
    if (!candidate) {
      throw buildGeminiError(json, 'No analysis candidate returned');
    }
    const part = candidate.content?.parts?.[0];
    if (!part) {
      throw buildGeminiError(json, 'No analysis content returned');
    }
    if (part.text) {
      return JSON.parse(part.text);
    }
    if (part.jsonValue) {
      return part.jsonValue;
    }
    throw buildGeminiError(json, 'Unsupported analysis payload shape');
  }

function buildGeminiError(payload, message, status) {
  const error = new Error(message);
  error.details = payload;
  error.status = status ?? payload?.error?.code;
  error.reason = payload?.error?.message;
  return error;
}

function parseRenderPayload(payload) {
  const candidate = payload.candidates?.[0];
  if (!candidate) {
    throw buildGeminiError(payload, 'No render candidate returned');
  }
  const part = candidate.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    throw buildGeminiError(payload, 'Render candidate missing inline data');
  }
  return {
    mimeType: part.inlineData.mimeType,
    data: part.inlineData.data,
  };
}

function promptWithSeed(prompt, seed) {
  return `${prompt}\nSeed Hint: ${seed}`;
}
