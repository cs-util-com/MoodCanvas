const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const FLASH_MODEL = 'models/gemini-2.5-flash:generateContent';
const FLASH_IMAGE_MODEL = 'models/gemini-2.5-flash-image:generateContent';

export const DEFAULT_TEXT_TIMEOUT_MS = 120_000;
export const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;
export const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.7,
  topP: 0.9,
  topK: 32,
};

export class GeminiClient {
  constructor({ apiKey = '', fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  async callFlash({
    parts,
    generationConfig = {},
    responseMimeType,
    responseSchema,
    timeoutMs = DEFAULT_TEXT_TIMEOUT_MS,
    signal,
  } = {}) {
    validateParts(parts);

    const config = buildGenerationConfig(generationConfig, responseMimeType, responseSchema);
    const body = {
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: config,
    };

    const response = await this.#request({ model: FLASH_MODEL, body, timeoutMs, signal });
    return response.json();
  }

  async callFlashImage({
    parts,
    generationConfig = {},
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    signal,
  } = {}) {
    validateParts(parts);

    const config = buildGenerationConfig(generationConfig);
    const body = {
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: config,
    };

    const response = await this.#request({ model: FLASH_IMAGE_MODEL, body, timeoutMs, signal });
    return response.json();
  }

  async #request({ model, body, timeoutMs, signal }) {
    this.#ensureKey();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

    const mergedSignal = signal ? mergeAbortSignals(signal, controller.signal) : controller.signal;

    try {
      const requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: mergedSignal,
      };

      const response = await Reflect.apply(
        this.fetchImpl,
        globalThis,
        [`${API_ROOT}/${model}`, requestOptions]
      );

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

function validateParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('parts are required for Gemini requests');
  }
}

function buildGenerationConfig(overrides = {}, responseMimeType, responseSchema) {
  const config = { ...DEFAULT_GENERATION_CONFIG, ...overrides };
  if (responseMimeType) {
    config.responseMimeType = responseMimeType;
  }
  if (responseSchema) {
    config.responseSchema = responseSchema;
  }
  return config;
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

function buildGeminiError(payload, message, status) {
  const error = new Error(message);
  error.details = payload;
  error.status = status ?? payload?.error?.code;
  error.reason = payload?.error?.message;
  return error;
}

