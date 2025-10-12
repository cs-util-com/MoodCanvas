export function parseFlashImageResponse(payload) {
  const candidate = selectCandidate(payload);
  const parts = candidate?.content?.parts ?? [];
  let imagePart = null;
  let descriptor = '';

  for (const part of parts) {
    if (!imagePart && part?.inlineData?.data) {
      imagePart = part;
      continue;
    }
    if (imagePart && !descriptor && typeof part?.text === 'string') {
      const trimmed = part.text.trim();
      if (trimmed) {
        descriptor = trimmed;
      }
    }
  }

  if (!imagePart) {
    const error = new Error('flash-image response missing image data');
    error.code = 'image-missing';
    error.payload = payload;
    throw error;
  }

  return {
    image: {
      data: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? 'image/jpeg',
    },
    text: descriptor,
  };
}

function selectCandidate(payload) {
  if (!payload?.candidates?.length) {
    const error = new Error('flash-image response missing candidates');
    error.code = 'no-candidates';
    error.payload = payload;
    throw error;
  }
  return payload.candidates[0];
}

