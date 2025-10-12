import { base64ToBlob, blobToBase64 } from './image.js';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TEXT_MODEL = 'models/gemini-2.5-flash:generateContent';
const GEMINI_IMAGE_MODEL = 'models/gemini-2.5-flash-image:generateContent';

let apiKey = '';
let defaultSampling = { temperature: 0.7, topP: 0.9, topK: 32 };

export function setIterationApiKey(nextKey) {
  apiKey = nextKey ?? '';
}

export function setDefaultSampling(sampling) {
  if (!sampling) return;
  defaultSampling = {
    temperature: clampNumber(sampling.temperature, 0, 1, 0.7),
    topP: clampNumber(sampling.topP, 0, 1, 0.9),
    topK: clampNumber(sampling.topK, 1, 64, 32),
  };
}

export function getDefaultSampling() {
  return { ...defaultSampling };
}

export const DEFAULT_SAMPLING = getDefaultSampling();

export const inlinePart = (mimeType, base64) => ({
  inlineData: { mimeType, data: base64 },
});

export const textPart = (text) => ({ text });

export async function generateRoomBrief({
  promptText,
  base64Main,
  mimeMain,
  signal,
}) {
  assertKey();
  const body = {
    contents: [
      { parts: [textPart(promptText), inlinePart(mimeMain, base64Main)] },
    ],
    generationConfig: { ...defaultSampling },
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

export async function generateVariant({
  promptText,
  base64Main,
  mimeMain,
  references = [],
  sampling = defaultSampling,
  signal,
}) {
  assertKey();
  const parts = composeParts(
    buildComposePayload({ promptText, base64Main, mimeMain, references })
  );
  return await requestImageModel(parts, sampling, signal);
}

export async function finalizeHiRes({
  promptText,
  base64Main,
  mimeMain,
  base64Child,
  mimeChild,
  references = [],
  sampling = defaultSampling,
  signal,
}) {
  assertKey();
  const parts = composeParts(
    buildComposePayload({
      promptText,
      base64Main,
      mimeMain,
      base64Child,
      mimeChild,
      references,
    })
  );
  return await requestImageModel(parts, sampling, signal);
}

export async function parseFlashImageResponse(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const image = extractInlineImage(parts);
  if (!image) {
    throw new Error('no_image_in_response');
  }

  const result = {
    imageUrl: image.url,
    text: extractText(parts),
    warnings: [],
    blob: image.blob,
    mime: image.mime,
  };

  if (!result.text) {
    result.warnings.push('auto-fixed: descriptor missing');
    result.text = await autoDescribeFromBlob(result.blob);
  }

  return result;
}

async function autoDescribeFromBlob(blob) {
  const base64 = await blobToBase64(blob);
  const body = {
    contents: [
      {
        parts: [
          {
            text: 'Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for the next iteration). Avoid lists, headings or markdown.',
          },
          inlinePart(blob.type || 'image/jpeg', base64),
        ],
      },
    ],
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

async function gemFetch(model, body, { signal } = {}) {
  assertKey();
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
    const error = new Error('Gemini request failed');
    error.details = payload;
    error.status = response.status;
    error.reason = payload?.error?.message;
    throw error;
  }
  return response.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: response.statusText };
  }
}

function assertKey() {
  if (!apiKey) {
    const error = new Error('Gemini API key missing');
    error.code = 'missing-key';
    throw error;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseFloat(value);
  if (Number.isNaN(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function composeParts({ promptText, main, child, references = [] }) {
  const parts = [textPart(promptText)];
  if (main) {
    parts.push(inlinePart(main.mime, main.base64));
  }
  if (child) {
    parts.push(inlinePart(child.mime, child.base64));
  }
  references.forEach((ref) => {
    parts.push(inlinePart(ref.mime, ref.base64));
  });
  return parts;
}

function buildComposePayload({
  promptText,
  base64Main,
  mimeMain,
  base64Child,
  mimeChild,
  references,
}) {
  const payload = { promptText };
  if (base64Main && mimeMain) {
    payload.main = { mime: mimeMain, base64: base64Main };
  }
  if (base64Child && mimeChild) {
    payload.child = { mime: mimeChild, base64: base64Child };
  }
  const filtered = (references || []).filter(Boolean);
  if (filtered.length > 0) {
    payload.references = filtered;
  }
  return payload;
}

async function requestImageModel(parts, sampling, signal) {
  const body = {
    contents: [{ parts }],
    generationConfig: { ...sampling },
  };
  const json = await gemFetch(GEMINI_IMAGE_MODEL, body, { signal });
  return await parseFlashImageResponse(json);
}

function extractInlineImage(parts) {
  for (const part of parts) {
    const inline = part.inlineData;
    if (!inline || !/^image\//i.test(inline.mimeType || '')) continue;
    const data = inline.data || inline.bytes || '';
    if (typeof data !== 'string' || data.length === 0) continue;
    const blob = base64ToBlob(data, inline.mimeType);
    return {
      blob,
      mime: blob.type,
      url: URL.createObjectURL(blob),
    };
  }
  return null;
}

function extractText(parts) {
  for (const part of parts) {
    if (typeof part.text === 'string') {
      const trimmed = part.text.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}
