import { base64ToBlob } from './image.js';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const DEFAULT_SAMPLING = { temperature: 0.7, topP: 0.9, topK: 32 };
export const DEFAULT_TEXT_TIMEOUT_MS = 90_000;
export const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;
const DESCRIBE_PROMPT = 'Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for the next iteration). Avoid lists, headings or markdown.';

export class GeminiClient {
  constructor({ apiKey = '', fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  async generateRoomBrief({
    promptText,
    base64Main,
    mimeMain = 'image/jpeg',
    sampling = DEFAULT_SAMPLING,
    timeoutMs = DEFAULT_TEXT_TIMEOUT_MS,
    signal,
  }) {
    if (!base64Main) {
      throw new Error('base64Main is required for room brief generation');
    }
    const body = {
      contents: [
        {
          parts: [
            { text: promptText },
            { inlineData: { mimeType: mimeMain, data: base64Main } },
          ],
        },
      ],
      generationConfig: { ...sampling },
    };
    const json = await this.#generate({ model: GEMINI_TEXT_MODEL, body, timeoutMs, signal });
    const raw = collectText(json);
    if (!raw) {
      throw buildGeminiError(json, 'room_brief_empty');
    }
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const paragraph = lines[0] ?? '';
    const bullets = lines.slice(1).map((line) => line.replace(/^[•\-–]\s?/, '')).filter(Boolean);
    return { paragraph, bullets, raw };
  }

  async generateVariant({
    promptText,
    base64Main,
    mimeMain = 'image/jpeg',
    references = [],
    sampling = DEFAULT_SAMPLING,
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    signal,
  }) {
    const json = await this.#generate({
      model: GEMINI_IMAGE_MODEL,
      timeoutMs,
      signal,
      body: buildImageBody({ promptText, base64Main, mimeMain, references, sampling }),
    });
    const parsed = parseFlashImageResponse(json);
    if (!parsed.text) {
      const fallback = await this.describeImage({ base64Image: parsed.imageBase64, mimeType: parsed.imageMimeType });
      parsed.text = fallback;
      parsed.warnings.push('auto-fixed: descriptor missing');
    }
    const blob = base64ToBlob(parsed.imageBase64, parsed.imageMimeType);
    const imageUrl = URL.createObjectURL(blob);
    return {
      imageUrl,
      imageBase64: parsed.imageBase64,
      imageMimeType: parsed.imageMimeType,
      text: parsed.text,
      warnings: parsed.warnings,
    };
  }

  async finalizeHiRes({
    promptText,
    base64Main,
    mimeMain = 'image/jpeg',
    base64Child,
    mimeChild = 'image/jpeg',
    references = [],
    sampling = DEFAULT_SAMPLING,
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    signal,
  }) {
    if (!base64Child) {
      throw new Error('base64Child is required for finalization');
    }
    const parts = [
      { text: promptText },
      { inlineData: { mimeType: mimeMain, data: base64Main } },
      { inlineData: { mimeType: mimeChild, data: base64Child } },
    ];
    references.forEach((ref) => {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    });
    const json = await this.#generate({
      model: GEMINI_IMAGE_MODEL,
      timeoutMs,
      signal,
      body: { contents: [{ parts }], generationConfig: { ...sampling } },
    });
    const parsed = parseFlashImageResponse(json);
    if (!parsed.text) {
      const fallback = await this.describeImage({ base64Image: parsed.imageBase64, mimeType: parsed.imageMimeType });
      parsed.text = fallback;
      parsed.warnings.push('auto-fixed: descriptor missing');
    }
    const blob = base64ToBlob(parsed.imageBase64, parsed.imageMimeType);
    const imageUrl = URL.createObjectURL(blob);
    return {
      imageUrl,
      imageBase64: parsed.imageBase64,
      imageMimeType: parsed.imageMimeType,
      text: parsed.text,
      warnings: parsed.warnings,
    };
  }

  async describeImage({
    promptText = DESCRIBE_PROMPT,
    base64Image,
    mimeType = 'image/jpeg',
    sampling = { temperature: 0.7 },
    timeoutMs = DEFAULT_TEXT_TIMEOUT_MS,
    signal,
  }) {
    if (!base64Image) {
      throw new Error('base64Image is required for describeImage');
    }
    const body = {
      contents: [
        {
          parts: [
            { text: promptText },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      generationConfig: { ...sampling },
    };
    const json = await this.#generate({ model: GEMINI_TEXT_MODEL, body, timeoutMs, signal });
    const text = collectText(json);
    if (!text) {
      throw buildGeminiError(json, 'mini_text_call_empty');
    }
    return text.trim();
  }

  async #generate({ model, body, timeoutMs, signal }) {
    this.#ensureKey();
    const response = await this.#request({ model, body, timeoutMs, signal });
    return response.json();
  }

  async #request({ model, body, timeoutMs, signal }) {
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
        [`${API_ROOT}/models/${model}:generateContent`, requestOptions],
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

export function parseFlashImageResponse(payload) {
  const candidate = payload?.candidates?.[0];
  if (!candidate) {
    throw buildGeminiError(payload, 'no_candidate');
  }
  const out = {
    imageBase64: null,
    imageMimeType: null,
    text: '',
    warnings: [],
  };
  const parts = candidate.content?.parts ?? [];
  for (const part of parts) {
    /* istanbul ignore next */
    if (!out.imageBase64 && part.inlineData && /^image\//i.test(part.inlineData.mimeType || '')) {
      out.imageBase64 = part.inlineData.data || part.inlineData.bytes || '';
      out.imageMimeType = part.inlineData.mimeType || 'image/jpeg';
    }
    /* istanbul ignore next */
    if (!out.text && typeof part.text === 'string' && part.text.trim()) {
      out.text = part.text.trim();
    }
    /* istanbul ignore next */
    if (out.imageBase64 && out.text) {
      break;
    }
  }
  if (!out.imageBase64) {
    throw buildGeminiError(payload, 'no_image_in_response');
  }
  return out;
}

function buildImageBody({ promptText, base64Main, mimeMain, references, sampling }) {
  if (!promptText) {
    throw new Error('promptText is required for image generation');
  }
  if (!base64Main) {
    throw new Error('base64Main is required for image generation');
  }
  const parts = [
    { text: promptText },
    { inlineData: { mimeType: mimeMain, data: base64Main } },
  ];
  (references ?? []).slice(0, 2).forEach((ref) => {
    /* istanbul ignore next */
    if (!ref?.base64) return;
    parts.push({ inlineData: { mimeType: ref.mimeType ?? ref.mime ?? 'image/jpeg', data: ref.base64 } });
  });
  return {
    contents: [{ parts }],
    generationConfig: { ...sampling },
  };
}

/* istanbul ignore next */
function mergeAbortSignals(a, b) {
  if (!a) return b;
  if (!b) return a;
  const controller = new AbortController();
  const abort = (event) => controller.abort(event?.target?.reason ?? a.reason ?? b.reason);
  a.addEventListener('abort', abort);
  b.addEventListener('abort', abort);
  return controller.signal;
}

/* istanbul ignore next */
async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: response.statusText };
  }
}

function collectText(json) {
  const candidate = json?.candidates?.[0];
  if (!candidate) return '';
  /* istanbul ignore next */
  return (candidate.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildGeminiError(payload, message, status) {
  const error = new Error(message);
  error.details = payload;
  error.status = status ?? payload?.error?.code;
  error.reason = payload?.error?.message;
  return error;
}
