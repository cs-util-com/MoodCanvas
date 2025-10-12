const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TEXT_MODEL = 'models/gemini-2.5-flash:generateContent';
const GEMINI_IMAGE_MODEL = 'models/gemini-2.5-flash-image:generateContent';

export const DEFAULT_SAMPLING = Object.freeze({
  temperature: 0.7,
  topP: 0.9,
  topK: 32,
});

let apiKey = '';

export function setGeminiApiKey(key) {
  apiKey = typeof key === 'string' ? key.trim() : '';
}

export function getGeminiApiKey() {
  return apiKey;
}

export async function gemFetch(model, body, { signal } = {}) {
  if (!apiKey) {
    const error = new Error('Gemini API key missing');
    error.code = 'missing-key';
    throw error;
  }

  const response = await fetch(`${API_ROOT}/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    const error = new Error(payload?.error?.message || 'Gemini request failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return response.json();
}

export const inlinePart = (mimeType, base64) => ({ inlineData: { mimeType, data: base64 } });
export const textPart = (text) => ({ text });

export async function generateRoomBrief({ promptText, base64Main, mimeMain, sampling = DEFAULT_SAMPLING, signal }) {
  const body = {
    contents: [
      { parts: [textPart(promptText), inlinePart(mimeMain, base64Main)] },
    ],
    generationConfig: { ...sampling },
  };

  const json = await gemFetch(GEMINI_TEXT_MODEL, body, { signal });
  const raw = (json?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!raw) {
    throw new Error('room_brief_empty');
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const paragraph = lines[0] || '';
  const bullets = lines.slice(1)
    .map((line) => line.replace(/^[•\-–]\s?/, ''))
    .filter(Boolean);

  return { paragraph, bullets, raw };
}

export async function generateVariant({
  promptText,
  base64Main,
  mimeMain,
  references = [],
  sampling = DEFAULT_SAMPLING,
  signal,
}) {
  const parts = [textPart(promptText), inlinePart(mimeMain, base64Main)];
  references.slice(0, 2).forEach((ref) => {
    parts.push(inlinePart(ref.mime, ref.base64));
  });

  const body = {
    contents: [{ parts }],
    generationConfig: { ...sampling },
  };

  const json = await gemFetch(GEMINI_IMAGE_MODEL, body, { signal });
  return parseFlashImageResponse(json);
}

export async function finalizeHiRes({
  promptText,
  base64Main,
  mimeMain,
  base64Child,
  mimeChild,
  references = [],
  sampling = DEFAULT_SAMPLING,
  signal,
}) {
  const parts = [
    textPart(promptText),
    inlinePart(mimeMain, base64Main),
    inlinePart(mimeChild, base64Child),
  ];

  references.slice(0, 2).forEach((ref) => {
    parts.push(inlinePart(ref.mime, ref.base64));
  });

  const body = {
    contents: [{ parts }],
    generationConfig: { ...sampling },
  };

  const json = await gemFetch(GEMINI_IMAGE_MODEL, body, { signal });
  return parseFlashImageResponse(json);
}

export async function parseFlashImageResponse(json) {
  const out = { imageUrl: null, text: '', warnings: [] };
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  for (const part of parts) {
    if (!out.imageUrl && part.inlineData && /^image\//i.test(part.inlineData.mimeType || '')) {
      const base64 = part.inlineData.data || part.inlineData.bytes || '';
      const blob = base64ToBlob(base64, part.inlineData.mimeType);
      out.imageUrl = createObjectUrl(blob);
    }
    if (!out.text && typeof part.text === 'string' && part.text.trim()) {
      out.text = part.text.trim();
    }
    if (out.imageUrl && out.text) break;
  }

  if (!out.imageUrl) {
    throw new Error('no_image_in_response');
  }

  if (!out.text) {
    out.warnings.push('auto-fixed: descriptor missing');
    out.text = await autoDescribeFromBlobUrl(out.imageUrl);
  }

  return out;
}

export async function autoDescribeFromBlobUrl(imageUrl) {
  const blob = await (await fetch(imageUrl)).blob();
  const base64 = await blobToBase64(blob);

  const body = {
    contents: [{
      parts: [
        textPart('Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for the next iteration). Avoid lists, headings or markdown.'),
        inlinePart(blob.type || 'image/jpeg', base64),
      ],
    }],
    generationConfig: { temperature: 0.7 },
  };

  const json = await gemFetch(GEMINI_TEXT_MODEL, body);
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

export function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  if (typeof base64 !== 'string') {
    throw new TypeError('Expected base64 string');
  }

  if (!base64) {
    return new Blob([], { type: mimeType });
  }

  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function blobToBase64(blob) {
  const buffer = await (typeof blob.arrayBuffer === 'function'
    ? blob.arrayBuffer()
    : new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    }));
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export async function blobUrlToBase64(url) {
  const blob = await (await fetch(url)).blob();
  return blobToBase64(blob);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: { message: response.statusText } };
  }
}

function createObjectUrl(blob) {
  const creator = typeof globalThis !== 'undefined'
    && globalThis.URL
    && typeof globalThis.URL.createObjectURL === 'function'
      ? globalThis.URL.createObjectURL.bind(globalThis.URL)
      : null;
  if (creator) {
    return creator(blob);
  }
  return `blob:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
