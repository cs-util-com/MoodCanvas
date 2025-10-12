import { base64ToBlob, blobToBase64 } from './image.js';

export const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const DEFAULT_SAMPLING = { temperature: 0.7, topP: 0.9, topK: 32 };

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/* istanbul ignore next */
export class GeminiFlows {
  constructor({
    apiKey = '',
    fetchImpl = fetch,
    createObjectURL = URL.createObjectURL,
  } = {}) {
    this.apiKey = apiKey?.trim?.() ?? '';
    this.fetchImpl = fetchImpl;
    this.createObjectURL = createObjectURL;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey?.trim?.() ?? '';
  }

  async generateRoomBrief({ promptText, base64Main, mimeMain }) {
    this.#ensureKey();
    const body = {
      contents: [
        {
          parts: [
            { text: promptText },
            { inlineData: { mimeType: mimeMain, data: base64Main } },
          ],
        },
      ],
      generationConfig: { ...DEFAULT_SAMPLING },
    };
    const json = await this.#gemFetch(`${GEMINI_TEXT_MODEL}`, body);
    const raw = (json?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!raw) {
      throw new Error('room_brief_empty');
    }
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const paragraph = lines[0] || '';
    const bullets = lines
      .slice(1)
      .map((line) => line.replace(/^[•\-–]\s?/, ''))
      .filter(Boolean);
    return { paragraph, bullets, raw };
  }

  async generateVariant({
    promptText,
    base64Main,
    mimeMain,
    references = [],
    sampling = DEFAULT_SAMPLING,
  }) {
    this.#ensureKey();
    const parts = buildGeminiParts({
      promptText,
      base64Main,
      mimeMain,
      references,
    });
    return this.#runImageCall({ parts, sampling });
  }

  async finalizeHiRes({
    promptText,
    base64Main,
    mimeMain,
    base64Child,
    mimeChild,
    references = [],
    sampling = DEFAULT_SAMPLING,
  }) {
    this.#ensureKey();
    const parts = buildGeminiParts({
      promptText,
      base64Main,
      mimeMain,
      child: { mime: mimeChild, base64: base64Child },
      references,
    });
    return this.#runImageCall({ parts, sampling });
  }

  async #parseFlashImageResponse(json) {
    return parseFlashImageResponse(json, {
      createObjectURL: this.createObjectURL,
      autoDescribe: ({ blob, mime }) => this.#autoDescribeFromBlob(blob, mime),
    });
  }

  async #runImageCall({ parts, sampling }) {
    const body = { contents: [{ parts }], generationConfig: { ...sampling } };
    const json = await this.#gemFetch(`${GEMINI_IMAGE_MODEL}`, body);
    return this.#parseFlashImageResponse(json);
  }

  async #autoDescribeFromBlob(blob, mime) {
    const base64 = await blobToBase64(blob);
    const body = {
      contents: [
        {
          parts: [
            {
              text: 'Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for next iteration). Avoid lists, headings or markdown.',
            },
            { inlineData: { mimeType: mime || 'image/jpeg', data: base64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.7 },
    };
    const json = await this.#gemFetch(`${GEMINI_TEXT_MODEL}`, body);
    const text = (json?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!text) {
      throw new Error('mini_text_call_empty');
    }
    return text;
  }

  async #gemFetch(model, body) {
    this.#ensureKey();
    const response = await this.fetchImpl(
      `${API_BASE}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      throw new Error(`gemini_${model}_http_${response.status}`);
    }
    return response.json();
  }

  #ensureKey() {
    if (!this.apiKey) {
      const error = new Error('Gemini API key missing');
      error.code = 'missing-key';
      throw error;
    }
  }
}

/* istanbul ignore next */
/* eslint-disable complexity */
export async function parseFlashImageResponse(
  json,
  { createObjectURL = URL.createObjectURL, autoDescribe } = {}
) {
  const out = { imageUrl: null, text: '', warnings: [] };
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  let imageBlob = null;
  let imageMime = 'image/jpeg';

  for (const part of parts) {
    if (
      !out.imageUrl &&
      part?.inlineData &&
      /^image\//i.test(part.inlineData.mimeType || '')
    ) {
      const data = part.inlineData.data || part.inlineData.bytes || '';
      imageMime = part.inlineData.mimeType || 'image/jpeg';
      imageBlob = base64ToBlob(data, imageMime);
      out.imageUrl = createObjectURL(imageBlob);
    }
    if (!out.text && typeof part?.text === 'string' && part.text.trim()) {
      out.text = part.text.trim();
    }
    if (out.imageUrl && out.text) {
      break;
    }
  }

  if (!out.imageUrl) {
    throw new Error('no_image_in_response');
  }
  if (!out.text) {
    if (typeof autoDescribe !== 'function') {
      throw new Error('auto_describe_missing_handler');
    }
    out.warnings.push('auto-fixed: descriptor missing');
    out.text = await autoDescribe({
      blob: imageBlob,
      mime: imageMime,
      imageUrl: out.imageUrl,
    });
  }

  return out;
}
/* eslint-enable complexity */

/* istanbul ignore next */
function buildGeminiParts({
  promptText,
  base64Main,
  mimeMain,
  child,
  references = [],
}) {
  const parts = [
    { text: promptText },
    { inlineData: { mimeType: mimeMain, data: base64Main } },
  ];
  if (child) {
    parts.push({ inlineData: { mimeType: child.mime, data: child.base64 } });
  }
  references.forEach((ref) => {
    parts.push({ inlineData: { mimeType: ref.mime, data: ref.base64 } });
  });
  return parts;
}
