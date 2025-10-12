import { base64ToBlob } from './image.js';
import { readGeminiKey } from './key-store.js';

export const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_SAMPLING = { temperature: 0.7, topP: 0.9, topK: 32 };

export async function generateRoomBrief({
  apiKey,
  promptText,
  base64Main,
  mimeMain,
  sampling = DEFAULT_SAMPLING,
  fetchImpl = fetch,
}) {
  assertBase64(base64Main, 'base room image');
  const key = ensureKey(apiKey);
  const body = {
    contents: [
      {
        parts: [textPart(promptText), inlinePart(mimeMain, base64Main)],
      },
    ],
    generationConfig: { ...sampling },
  };
  const json = await gemFetch({
    apiKey: key,
    model: GEMINI_TEXT_MODEL,
    body,
    fetchImpl,
  });
  const raw = extractTextParts(json)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
  if (!raw) {
    throw new Error('room_brief_empty');
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const paragraph = lines[0] ?? '';
  const bullets = lines
    .slice(1)
    .map((line) => line.replace(/^[•\-–]\s?/, ''))
    .filter(Boolean);
  return { paragraph, bullets, raw };
}

export async function generateVariant({
  apiKey,
  promptText,
  base64Main,
  mimeMain,
  references = [],
  sampling = DEFAULT_SAMPLING,
  fetchImpl = fetch,
}) {
  assertBase64(base64Main, 'base room image');
  const key = ensureKey(apiKey);
  const parts = buildImageParts({
    promptText,
    base64Main,
    mimeMain,
    references,
  });
  return callImageModel({ apiKey: key, parts, sampling, fetchImpl });
}

export async function finalizeHiRes({
  apiKey,
  promptText,
  base64Main,
  mimeMain,
  base64Child,
  mimeChild,
  references = [],
  sampling = DEFAULT_SAMPLING,
  fetchImpl = fetch,
}) {
  assertBase64(base64Main, 'base room image');
  assertBase64(base64Child, 'selected child image');
  const key = ensureKey(apiKey);
  const parts = buildImageParts({
    promptText,
    base64Main,
    mimeMain,
    references,
    child: { base64: base64Child, mime: mimeChild },
  });
  return callImageModel({ apiKey: key, parts, sampling, fetchImpl });
}

export async function parseFlashImageResponse(
  json,
  { apiKey, fetchImpl = fetch } = {}
) {
  const out = {
    imageUrl: null,
    text: '',
    warnings: [],
    base64: null,
    mimeType: 'image/jpeg',
  };
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (!out.imageUrl && part?.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? 'image/jpeg';
      const b64 = part.inlineData.data ?? part.inlineData.bytes ?? '';
      out.base64 = b64;
      out.mimeType = mime;
      out.imageUrl = createObjectUrlFromBase64(b64, mime);
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
    out.warnings.push('auto-fixed: descriptor missing');
    out.text = await autoDescribeFromBase64({
      base64: out.base64,
      mimeType: out.mimeType,
      apiKey,
      fetchImpl,
    });
  }
  return out;
}

function inlinePart(mimeType, base64) {
  return { inlineData: { mimeType, data: base64 } };
}

function textPart(text) {
  return { text };
}

function buildImageParts({
  promptText,
  base64Main,
  mimeMain,
  references = [],
  child,
}) {
  const parts = [textPart(promptText), inlinePart(mimeMain, base64Main)];
  if (child?.base64) {
    parts.push(inlinePart(child.mime ?? 'image/jpeg', child.base64));
  }
  references.forEach((ref) => {
    if (ref?.base64) {
      parts.push(inlinePart(ref.mime ?? 'image/jpeg', ref.base64));
    }
  });
  return parts;
}

async function callImageModel({
  apiKey,
  parts,
  sampling = DEFAULT_SAMPLING,
  fetchImpl = fetch,
}) {
  const body = {
    contents: [{ parts }],
    generationConfig: { ...sampling },
  };
  const json = await gemFetch({
    apiKey,
    model: GEMINI_IMAGE_MODEL,
    body,
    fetchImpl,
  });
  return parseFlashImageResponse(json, { apiKey, fetchImpl });
}

async function autoDescribeFromBase64({
  base64,
  mimeType,
  apiKey,
  fetchImpl = fetch,
}) {
  if (!base64) {
    throw new Error('mini_text_call_empty');
  }
  const key = ensureKey(apiKey);
  const body = {
    contents: [
      {
        parts: [
          textPart(
            'Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for the next iteration). Avoid lists, headings or markdown.'
          ),
          inlinePart(mimeType ?? 'image/jpeg', base64),
        ],
      },
    ],
    generationConfig: { temperature: 0.7 },
  };
  const json = await gemFetch({
    apiKey: key,
    model: GEMINI_TEXT_MODEL,
    body,
    fetchImpl,
  });
  const text = extractTextParts(json)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!text) {
    throw new Error('mini_text_call_empty');
  }
  return text;
}

function extractTextParts(json) {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => part?.text)
    .filter((value) => typeof value === 'string');
}

async function gemFetch({ apiKey, model, body, fetchImpl = fetch }) {
  const key = ensureKey(apiKey);
  const response = await Reflect.apply(fetchImpl, globalThis, [
    `${API_BASE}/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
    },
  ]);
  if (!response.ok) {
    const payload = await safeJson(response);
    const error = new Error('gemini_http_error');
    error.status = response.status;
    error.details = payload;
    throw error;
  }
  return response.json();
}

function ensureKey(apiKey) {
  const key = (apiKey ?? readGeminiKey()).trim();
  if (!key) {
    const error = new Error('Gemini API key missing');
    error.code = 'missing-key';
    throw error;
  }
  return key;
}

function assertBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing base64 data for ${label}`);
  }
}

function createObjectUrlFromBase64(base64, mimeType) {
  const blob = base64ToBlob(base64, mimeType);
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(blob);
  }
  return `data:${mimeType};base64,${base64}`;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return { error: response.statusText ?? error.message };
  }
}
