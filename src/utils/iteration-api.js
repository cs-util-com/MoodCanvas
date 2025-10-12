import { blobToBase64 } from './image.js';

export const GEMINI_TEXT_MODEL = 'models/gemini-2.5-flash:generateContent';
export const GEMINI_IMAGE_MODEL =
  'models/gemini-2.5-flash-image:generateContent';

export const DEFAULT_SAMPLING = Object.freeze({
  temperature: 0.7,
  topP: 0.9,
  topK: 32,
});

export const inlinePart = (mimeType, base64) => ({
  inlineData: { mimeType, data: base64 },
});
export const textPart = (text) => ({ text });

export class IterationApi {
  constructor({ client }) {
    if (!client) {
      throw new Error('client is required');
    }
    this.client = client;
  }

  async generateRoomBrief({ promptText, base64Main, mimeMain }) {
    const body = {
      contents: [
        {
          parts: [textPart(promptText), inlinePart(mimeMain, base64Main)],
        },
      ],
      generationConfig: { ...DEFAULT_SAMPLING },
    };
    const json = await this.client.generateContent({
      model: GEMINI_TEXT_MODEL,
      body,
      timeoutMs: 120_000,
    });
    const raw = (json?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n')
      .trim();
    /* istanbul ignore next */
    if (!raw) {
      throw new Error('room_brief_empty');
    }
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const [paragraph = ''] = lines;
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
    const parts = [textPart(promptText), inlinePart(mimeMain, base64Main)];
    references.forEach((ref) => parts.push(inlinePart(ref.mime, ref.base64)));
    return this._runImageRequest(parts, sampling);
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
    references.forEach((ref) => parts.push(inlinePart(ref.mime, ref.base64)));
    return this._runImageRequest(parts, sampling);
  }

  async _runImageRequest(parts, sampling) {
    const body = { contents: [{ parts }], generationConfig: { ...sampling } };
    const json = await this.client.generateContent({
      model: GEMINI_IMAGE_MODEL,
      body,
      timeoutMs: 180_000,
    });
    return this.parseFlashImageResponse(json);
  }

  async parseFlashImageResponse(json) {
    const out = { imageUrl: null, text: '', warnings: [] };
    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      /* istanbul ignore next */
      if (
        !out.imageUrl &&
        part.inlineData &&
        /^image\//i.test(part.inlineData.mimeType || '')
      ) {
        const base64 = part.inlineData.data || part.inlineData.bytes || '';
        const mimeType = part.inlineData.mimeType || 'application/octet-stream';
        out.imageUrl = `data:${mimeType};base64,${base64}`;
      }
      if (!out.text && typeof part.text === 'string' && part.text.trim()) {
        out.text = part.text.trim();
      }
      if (out.imageUrl && out.text) break;
    }
    /* istanbul ignore next */
    if (!out.imageUrl) {
      throw new Error('no_image_in_response');
    }
    if (!out.text) {
      out.warnings.push('auto-fixed: descriptor missing');
      out.text = await this.autoDescribeFromBlobUrl(out.imageUrl);
    }
    return out;
  }

  async autoDescribeFromBlobUrl(imageUrl) {
    const blob = await (await fetch(imageUrl)).blob();
    const base64 = await blobToBase64(blob);
    const body = {
      contents: [
        {
          parts: [
            {
              text: 'Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for the next iteration). Avoid lists, headings or markdown.',
            },
            {
              inlineData: {
                mimeType: blob.type || 'image/jpeg',
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.7 },
    };
    const json = await this.client.generateContent({
      model: GEMINI_TEXT_MODEL,
      body,
      timeoutMs: 90_000,
    });
    const text = (json?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join(' ')
      .trim();
    /* istanbul ignore next */
    if (!text) {
      throw new Error('mini_text_call_empty');
    }
    return text;
  }
}
