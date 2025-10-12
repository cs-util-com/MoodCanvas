import { base64ToBlob, blobToBase64 } from './image.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TEXT_MODEL = 'models/gemini-2.5-flash:generateContent';
const IMAGE_MODEL = 'models/gemini-2.5-flash-image:generateContent';

export const DEFAULT_SAMPLING = Object.freeze({ temperature: 0.7, topP: 0.9, topK: 32 });

const textPart = (text) => ({ text });
const inlinePart = (mimeType, data) => ({ inlineData: { mimeType, data } });

export class GeminiIECClient {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.apiKey = '';
  }

  setApiKey(key) {
    this.apiKey = typeof key === 'string' ? key.trim() : '';
  }

  async generateRoomBrief({ promptText, base64Main, mimeMain, sampling = DEFAULT_SAMPLING }) {
    const body = {
      contents: [
        {
          parts: [textPart(promptText), inlinePart(mimeMain, base64Main)],
        },
      ],
      generationConfig: { ...sampling },
    };

    const json = await this.#request(TEXT_MODEL, body);
    const raw = (json?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!raw) {
      throw new Error('room_brief_empty');
    }

    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const paragraph = lines[0] ?? '';
    const bullets = lines.slice(1).map((line) => line.replace(/^[•\-–]\s?/, '')).filter(Boolean);

    return { paragraph, bullets, raw };
  }

  async generateVariant({
    promptText,
    base64Main,
    mimeMain,
    references = [],
    sampling = DEFAULT_SAMPLING,
  }) {
    const parts = [textPart(promptText), inlinePart(mimeMain, base64Main)];
    references.forEach((reference) => parts.push(inlinePart(reference.mime, reference.base64)));
    const body = {
      contents: [{ parts }],
      generationConfig: { ...sampling },
    };
    const json = await this.#request(IMAGE_MODEL, body);
    return this.parseFlashImageResponse(json);
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
    const parts = [
      textPart(promptText),
      inlinePart(mimeMain, base64Main),
      inlinePart(mimeChild, base64Child),
    ];
    references.forEach((reference) => parts.push(inlinePart(reference.mime, reference.base64)));
    const body = {
      contents: [{ parts }],
      generationConfig: { ...sampling },
    };
    const json = await this.#request(IMAGE_MODEL, body);
    return this.parseFlashImageResponse(json);
  }

  async parseFlashImageResponse(json) {
    const output = { imageUrl: null, text: '', warnings: [] };
    const parts = json?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (!output.imageUrl && part.inlineData && /^image\//i.test(part.inlineData.mimeType ?? '')) {
        const inlineData = part.inlineData.data || part.inlineData.bytes || '';
        const blob = base64ToBlob(inlineData, part.inlineData.mimeType);
        output.imageUrl = URL.createObjectURL(blob);
      }
      if (!output.text && typeof part.text === 'string' && part.text.trim()) {
        output.text = part.text.trim();
      }
      if (output.imageUrl && output.text) break;
    }

    if (!output.imageUrl) {
      throw new Error('no_image_in_response');
    }

    if (!output.text) {
      output.warnings.push('auto-fixed: descriptor missing');
      output.text = await this.#autoDescribeFromImageUrl(output.imageUrl);
    }

    return output;
  }

  async #autoDescribeFromImageUrl(url) {
    const blob = await (await this.fetchImpl(url)).blob();
    const base64 = await blobToBase64(blob);
    const body = {
      contents: [
        {
          parts: [
            textPart(
              'Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for next iteration). Avoid lists, headings or markdown.'
            ),
            inlinePart(blob.type || 'image/jpeg', base64),
          ],
        },
      ],
      generationConfig: { ...DEFAULT_SAMPLING, temperature: 0.7 },
    };
    const json = await this.#request(TEXT_MODEL, body);
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

  async #request(model, body) {
    if (!this.apiKey) {
      throw Object.assign(new Error('Gemini API key missing'), { code: 'missing-key' });
    }

    const response = await this.fetchImpl(`${API_BASE}/${model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      const error = new Error('Gemini request failed');
      error.status = response.status;
      error.reason = message;
      throw error;
    }

    return response.json();
  }
}

export const parts = { textPart, inlinePart };
